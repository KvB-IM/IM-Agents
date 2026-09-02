import "server-only";

/**
 * Zoho CRM client — service-account model.
 *
 * ONE connection for the whole app, because field agents have no Zoho accounts
 * (SOFTWARE_SCOPE.md §2.2). Token handling is ported from IM-Website, which has
 * been running this exact flow in production.
 *
 * The consequence of one identity is the whole of §7: Zoho will return the
 * entire book of business to any caller here, so the per-agent filter is this
 * app's responsibility. Never build a criteria string by hand — go through
 * AgentScope (lib/scope.ts).
 */

const ACCOUNTS_HOST = process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.com";
const API_HOST = process.env.ZOHO_API_HOST || "https://www.zohoapis.com";
const API_VERSION = "v8";

export function zohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN,
  );
}

export class ZohoError extends Error {
  constructor(
    public status: number,
    public userMessage: string,
    detail?: string,
  ) {
    super(detail ?? userMessage);
    this.name = "ZohoError";
  }
}

/**
 * True for anything this module or ./coql throws — both carry a `status` and a
 * `userMessage` written for a person.
 *
 * Routes test with this rather than `instanceof ZohoError`, so a
 * QueryValueError from the injection guard is reported the same way instead of
 * escaping as an unhandled 500.
 */
export function isUpstreamError(
  err: unknown,
): err is { status: number; userMessage: string; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { userMessage?: unknown }).userMessage === "string"
  );
}

/**
 * A create refused because a unique field already holds this value.
 *
 * Not an error condition for this app: it is how a replayed submission is
 * detected, now that the Jot's Form ID is derived deterministically from the
 * agent and their submission key.
 */
export class DuplicateRecordError extends Error {
  field: string;

  constructor(field: string) {
    super(`Duplicate value on ${field}`);
    this.name = "DuplicateRecordError";
    this.field = field;
  }
}

/* ── Access token ──────────────────────────────────────────────────────────
 * Cached on globalThis rather than in a module const: Next re-evaluates route
 * modules in dev, and a per-module cache would refresh on every navigation and
 * burn through Zoho's refresh-call limit. */
interface TokenCache {
  token: string | null;
  expiresAt: number;
  inFlight: Promise<string> | null;
}

const g = globalThis as unknown as { __imZohoToken?: TokenCache };
g.__imZohoToken ??= { token: null, expiresAt: 0, inFlight: null };
const tokenCache = g.__imZohoToken;

async function fetchAccessToken(): Promise<string> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new ZohoError(500, "Zoho is not configured on this server.");
  }

  const res = await fetch(`${ACCOUNTS_HOST}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };

  if (!res.ok || data.error || !data.access_token) {
    // The refresh token itself is what goes wrong here — revoked, wrong data
    // centre, or a scope removed — so name that without leaking the token.
    throw new ZohoError(
      502,
      "The CRM connection could not be renewed. The refresh token may have been revoked, or the data centre may be wrong.",
      `token refresh ${res.status}: ${data.error ?? "no access_token"}`,
    );
  }

  // A minute of headroom, so a request never starts with a token that expires
  // mid-flight.
  tokenCache.token = data.access_token;
  tokenCache.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000;
  return data.access_token;
}

async function accessToken(): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;

  // Collapse concurrent refreshes. Without this a cold page rendering several
  // server components fires several refreshes at once, and Zoho rate-limits
  // refresh calls hard.
  tokenCache.inFlight ??= fetchAccessToken().finally(() => {
    tokenCache.inFlight = null;
  });
  return tokenCache.inFlight;
}

/** Authenticated CRM request. Retries once on a 401, in case the cached token
 *  was revoked server-side before its stated expiry. */
async function zohoFetch(path: string, init?: RequestInit, retry = true): Promise<Response> {
  const token = await accessToken();
  const res = await fetch(`${API_HOST}/crm/${API_VERSION}${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (res.status === 401 && retry) {
    tokenCache.token = null;
    tokenCache.expiresAt = 0;
    return zohoFetch(path, init, false);
  }
  return res;
}

/* ── COQL ──────────────────────────────────────────────────────────────────
 * COQL has no parameter binding, so every value reaching a query string has to
 * be validated. Those guards live in ./coql.ts — pure, import-free and directly
 * unit-tested, because they are the entire boundary between an agent name and
 * an injected WHERE clause. Re-exported here so callers have one import.
 */
export { coqlLiteral, assertRecordId } from "./coql";
// Also imported, not merely re-exported: the write helpers below validate ids
// themselves so an id cannot reach a URL path unchecked.
import { assertRecordId } from "./coql";

export interface CoqlPage<T> {
  rows: T[];
  moreRecords: boolean;
}

/**
 * Run a COQL select.
 *
 * Returns an empty page rather than throwing when nothing matches: COQL answers
 * "no rows" with a 204 and no body, which is a normal result, not an error.
 * Getting this wrong makes an agent with no forms look like an outage.
 */
export async function coql<T = Record<string, unknown>>(
  selectQuery: string,
): Promise<CoqlPage<T>> {
  const res = await zohoFetch("/coql", {
    method: "POST",
    body: JSON.stringify({ select_query: selectQuery }),
  });

  if (res.status === 204) return { rows: [], moreRecords: false };

  const body = (await res.json().catch(() => ({}))) as {
    data?: T[];
    info?: { more_records?: boolean };
    code?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new ZohoError(
      res.status === 429 ? 429 : 502,
      res.status === 429
        ? "The CRM is rate-limiting us. Try again in a moment."
        : "The CRM rejected the query.",
      `coql ${res.status}: ${body.code ?? ""} ${body.message ?? ""}`.trim(),
    );
  }

  return { rows: body.data ?? [], moreRecords: body.info?.more_records === true };
}

/* ── Record writes ─────────────────────────────────────────────────────── */

interface WriteResult {
  id: string;
}

/**
 * Create one record.
 *
 * Note what is NOT sent: `trigger: []`. Suppressing workflows would make a Jot
 * arriving from the field behave differently from one arriving through JotForm,
 * and the office's automation is what moves a form through validation. The two
 * intake paths must fire the same rules.
 */
export async function createRecord(
  module: string,
  record: Record<string, unknown>,
): Promise<WriteResult> {
  const res = await zohoFetch(`/${module}`, {
    method: "POST",
    body: JSON.stringify({ data: [record] }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{
      code?: string;
      message?: string;
      status?: string;
      details?: { id?: string; api_name?: string };
    }>;
  };

  const row = body.data?.[0];

  // Zoho rejects a duplicate value on a unique field with this code. For JOTS
  // that means `Name` already exists — i.e. this exact submission was already
  // filed — which is a normal replay, not a failure. Raised as its own type so
  // the caller can resolve it to the existing record.
  if (row?.code === "DUPLICATE_DATA") {
    throw new DuplicateRecordError(String(row.details?.api_name ?? "Name"));
  }

  if (!res.ok || row?.status !== "success" || !row?.details?.id) {
    // Zoho reports per-record failures inside a 2xx envelope, so the row status
    // matters as much as the HTTP status. `api_name` in the details names the
    // offending field, which is the one part worth surfacing to a person.
    const field = row?.details?.api_name;
    throw new ZohoError(
      502,
      field ? `The CRM rejected the form on "${field}".` : "The CRM rejected the form.",
      `create ${module} ${res.status}: ${row?.code ?? ""} ${row?.message ?? ""}`.trim(),
    );
  }

  return { id: row.details.id };
}

/** Update one record by id. */
export async function updateRecord(
  module: string,
  id: string,
  record: Record<string, unknown>,
): Promise<WriteResult> {
  const safeId = assertRecordId(id);
  const res = await zohoFetch(`/${module}/${safeId}`, {
    method: "PUT",
    body: JSON.stringify({ data: [record] }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{
      code?: string;
      message?: string;
      status?: string;
      details?: { id?: string; api_name?: string };
    }>;
  };

  const row = body.data?.[0];
  if (!res.ok || row?.status !== "success") {
    const field = row?.details?.api_name;
    throw new ZohoError(
      502,
      field ? `The CRM rejected the change on "${field}".` : "The CRM rejected the change.",
      `update ${module}/${safeId} ${res.status}: ${row?.code ?? ""} ${row?.message ?? ""}`.trim(),
    );
  }

  return { id: safeId };
}

/**
 * Read one record, optionally limited to named fields.
 *
 * Subform rows come back only on a single-record GET — a COQL select or a
 * multi-record `ids=` fetch silently omits them, which is how household members
 * went missing in IM_CRM_Frontend. So a caller that needs `Jot_Dependents` has
 * to come through here, not through `coql`.
 */
export async function getRecord<T = Record<string, unknown>>(
  module: string,
  id: string,
  fields?: string[],
): Promise<T | null> {
  const safeId = assertRecordId(id);
  const qs = fields?.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
  const res = await zohoFetch(`/${module}/${safeId}${qs}`);

  if (res.status === 204 || res.status === 404) return null;

  const body = (await res.json().catch(() => ({}))) as { data?: T[] };
  if (!res.ok) {
    throw new ZohoError(502, "The CRM could not be read.", `get ${module}/${safeId} ${res.status}`);
  }
  return body.data?.[0] ?? null;
}

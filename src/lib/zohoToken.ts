import "server-only";
import { sql, dbConfigured } from "./db";
import { encryptSecret, decryptSecret, encryptionConfigured } from "./crypto";

/**
 * Where the Zoho refresh token comes from.
 *
 * Two sources, in this order:
 *
 *   1. `ZOHO_REFRESH_TOKEN` in the environment. Wins when set, so a deployment
 *      can be pinned to a known-good token without touching the database, and
 *      so the app runs before any of this schema exists.
 *
 *   2. The `zoho_connection` row, encrypted. Written by the OAuth callback,
 *      which is what makes "Reconnect Zoho" an admin clicking a button rather
 *      than an engineer redeploying.
 *
 * Cached in-process for a short while. Without it every access-token refresh
 * would also cost a database round trip, and the token itself changes only when
 * somebody reconnects.
 */

interface TokenCache {
  token: string | null;
  apiDomain: string | null;
  readAt: number;
}

const CACHE_TTL_MS = 60_000;

const g = globalThis as unknown as { __imZohoRefresh?: TokenCache };
g.__imZohoRefresh ??= { token: null, apiDomain: null, readAt: 0 };
const cache = g.__imZohoRefresh;

export interface ZohoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Zoho returns the correct API domain on exchange; prefer it over a guess. */
  apiDomain: string | null;
  source: "env" | "database";
}

/** True when a client id/secret pair is configured — the part that always
 *  comes from the environment, because it identifies the app itself. */
export function zohoClientConfigured(): boolean {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

/**
 * Resolve the full credential set, or null when the app is not connected.
 *
 * Returning null rather than throwing is deliberate: "not connected to the CRM"
 * is a normal state for a fresh deployment, and it degrades to fixture data
 * with a visible badge rather than an error page.
 */
export async function zohoCredentials(): Promise<ZohoCredentials | null> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const envToken = process.env.ZOHO_REFRESH_TOKEN;
  if (envToken) {
    return {
      clientId,
      clientSecret,
      refreshToken: envToken,
      apiDomain: process.env.ZOHO_API_HOST ?? null,
      source: "env",
    };
  }

  if (!dbConfigured() || !encryptionConfigured()) return null;

  if (cache.token && Date.now() - cache.readAt < CACHE_TTL_MS) {
    return {
      clientId,
      clientSecret,
      refreshToken: cache.token,
      apiDomain: cache.apiDomain,
      source: "database",
    };
  }

  try {
    const db = sql();
    const rows = (await db`
      select refresh_token_cipher, api_domain from zoho_connection where id = true limit 1
    `) as Array<{ refresh_token_cipher: string; api_domain: string | null }>;

    const row = rows[0];
    if (!row) return null;

    const token = decryptSecret(row.refresh_token_cipher);
    if (!token) {
      // Decryption failed — almost always a rotated APP_ENCRYPTION_KEY. Say so
      // loudly, because the symptom otherwise is "the CRM silently went away".
      console.error(
        "[zoho] stored refresh token could not be decrypted. " +
          "APP_ENCRYPTION_KEY has probably changed — an admin needs to reconnect Zoho.",
      );
      return null;
    }

    cache.token = token;
    cache.apiDomain = row.api_domain;
    cache.readAt = Date.now();

    return {
      clientId,
      clientSecret,
      refreshToken: token,
      apiDomain: row.api_domain,
      source: "database",
    };
  } catch (err) {
    console.error("[zoho] could not read the stored connection:", err);
    return null;
  }
}

/** Store a refresh token obtained from the OAuth callback. */
export async function saveZohoConnection(opts: {
  refreshToken: string;
  scopes: string | null;
  apiDomain: string | null;
  agentId: string | null;
}): Promise<void> {
  const db = sql();
  const cipher = encryptSecret(opts.refreshToken);

  await db`
    insert into zoho_connection (id, refresh_token_cipher, scopes, api_domain,
                                 connected_at, connected_by, last_error, last_error_at)
    values (true, ${cipher}, ${opts.scopes}, ${opts.apiDomain}, now(), ${opts.agentId},
            null, null)
    on conflict (id) do update
       set refresh_token_cipher = excluded.refresh_token_cipher,
           scopes        = excluded.scopes,
           api_domain    = excluded.api_domain,
           connected_at  = now(),
           connected_by  = excluded.connected_by,
           last_error    = null,
           last_error_at = null
  `;

  // Invalidate immediately: a reconnect has to take effect on the next request,
  // not up to a minute later.
  cache.token = null;
  cache.readAt = 0;
}

/** Record a refresh failure, so a dead connection is visible in the health
 *  check before an agent reports it. */
export async function noteZohoError(message: string): Promise<void> {
  if (!dbConfigured()) return;
  try {
    const db = sql();
    await db`
      update zoho_connection
         set last_error = ${message.slice(0, 500)}, last_error_at = now()
       where id = true
    `;
  } catch {
    /* recording a failure must never itself fail a request */
  }
}

/** Note a successful refresh. Cheap, and it is how you tell a live connection
 *  from one that has not been exercised since it broke. */
export async function noteZohoRefresh(): Promise<void> {
  if (!dbConfigured()) return;
  try {
    const db = sql();
    await db`update zoho_connection set last_refresh_at = now() where id = true`;
  } catch {
    /* best effort */
  }
}

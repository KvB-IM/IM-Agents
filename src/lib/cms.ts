import "server-only";
import {
  batchPlanIds,
  joinIds,
  readStatus,
  type CoverageRow,
} from "./cmsCoverage.ts";
import { rankDrugs } from "./drugRank.ts";

/**
 * CMS Marketplace API — drug and provider coverage.
 *
 * HealthSherpa quotes the plans but cannot answer "is my drug covered" or "is
 * my doctor in network": `/v1/quotes` has no filter for either, and the only
 * drug data on a quoted plan is a formulary PDF link. CMS publishes both, keyed
 * on the 14-character HIOS plan id — which is exactly what HealthSherpa returns
 * as `plan_id`, so the two join with no mapping table.
 *
 * ── The key expires every 60 days ────────────────────────────────────────
 * CMS auto-renews it by email. That makes a silent expiry the likely failure,
 * so nothing here is allowed to break a quote: every function throws a typed
 * error the caller turns into "coverage unavailable", and the plan list renders
 * without badges rather than not at all. Coverage is an enhancement to a quote,
 * never a precondition for one.
 */

const BASE = "https://marketplace.api.healthcare.gov/api/v1";
const TIMEOUT_MS = 20_000;

export class CmsError extends Error {
  status: number;
  userMessage: string;

  constructor(status: number, userMessage: string, detail?: string) {
    super(detail ?? userMessage);
    this.name = "CmsError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

export function cmsConfigured(): boolean {
  return Boolean(process.env.CMS_API_KEY);
}

function apiKey(): string {
  const key = process.env.CMS_API_KEY;
  if (!key) throw new CmsError(501, "Drug and provider lookup is not configured.");
  return key;
}

async function cmsGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params);
  /* Appended last and never logged. The URL carries the key, so the URL is a
   * secret — errors below quote the path and status, never the query. */
  query.set("apikey", apiKey());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?${query}`, {
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new CmsError(504, "The coverage lookup timed out.");
    }
    throw new CmsError(502, "Could not reach the coverage service.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    /* The 60-day expiry, most likely. Loud in the log because nothing in the
     * UI can diagnose it and the fix is a new key in the environment. */
    console.error(
      `[cms] ${res.status} on ${path} — the CMS_API_KEY is rejected. ` +
        `Keys expire every 60 days; check for the renewal email.`,
    );
    throw new CmsError(502, "The coverage service rejected our credentials.");
  }
  if (res.status === 429) {
    throw new CmsError(429, "Too many coverage lookups just now. Try again in a moment.");
  }
  if (res.status === 400) {
    /* CMS's own validation. The one that matters is the plan year: it rejects
     * a year it has not published yet — `year=2027` returns "Invalid market
     * year" — and during open enrollment a January effective date is the
     * NORMAL choice, so this is not an edge case, it is the busiest month of
     * the year. Reported specifically so the agent is told the data does not
     * exist rather than that something broke. */
    const detail = await res.text().catch(() => "");
    if (/market year/i.test(detail)) {
      throw new CmsError(
        422,
        "CMS has not published formulary and network data for that plan year yet.",
        detail.slice(0, 200),
      );
    }
    console.error(`[cms] 400 on ${path}: ${detail.slice(0, 200)}`);
    throw new CmsError(502, "The coverage lookup was rejected.");
  }
  if (!res.ok) {
    console.error(`[cms] ${res.status} on ${path}`);
    throw new CmsError(502, "The coverage lookup failed.");
  }

  return (await res.json()) as T;
}

/* ── Drugs ───────────────────────────────────────────────────────────────── */

export interface DrugHit {
  rxcui: string;
  name: string;
  strength: string;
  route: string;
  fullName: string;
}

/**
 * Search the medication catalogue.
 *
 * `/drugs/search`, not `/drugs/autocomplete`: autocomplete caps at ten results
 * ordered by rxcui, so "metformin" came back as five combination products and
 * no plain metformin. The two also answer different shapes — search returns
 * `{total, drugs}`, autocomplete a bare array — which reads as an empty result
 * rather than an error if you assume.
 *
 * ── Paging, because 25 is not the answer ─────────────────────────────────
 * Search reports a `total` and then returns only 25. "metformin" reports 129,
 * and plain "metFORMIN 500 mg" — the thing the client actually takes — is not
 * in the first 25. The page parameter is `offset`, not `page`, `limit`, `size`
 * or any of the usual spellings, all of which are accepted and ignored.
 *
 * ── Then ranked, because CMS's order is not relevance ────────────────────
 * Its first page for "metformin" is ACTOPLUS MET, metFORMIN/Pioglitazone,
 * JANUMET. See lib/drugRank.ts.
 */
export async function searchDrugs(query: string, year: number): Promise<DrugHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];

  const collected: RawDrug[] = [];
  let total = Infinity;

  /* Bounded, so a query like "insulin" cannot turn one button press into
     twenty upstream calls while an agent waits — but high enough to actually
     reach the answer. A 100-result cap was not: "metformin" has 129 matches
     and every plain metFORMIN entry sits beyond the hundredth, so the ranking
     had nothing to promote and the agent still saw pioglitazone combinations.
     Stops as soon as CMS's own `total` is reached, which is under 50 results
     for most brand names. */
  for (let offset = 0; offset < Math.min(total, MAX_CANDIDATES); offset += PAGE_SIZE) {
    const data = await cmsGet<{ total?: number; drugs?: RawDrug[] }>("/drugs/search", {
      q,
      year: String(year),
      offset: String(offset),
    });
    total = Number(data.total ?? 0);
    const batch = data.drugs ?? [];
    collected.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const hits: DrugHit[] = collected.map((d) => ({
    rxcui: String(d.rxcui ?? ""),
    name: String(d.name ?? ""),
    strength: String(d.strength ?? ""),
    route: String(d.route ?? ""),
    fullName: String(d.full_name ?? ""),
  }));

  return rankDrugs(hits, q, 40);
}

/** Fixed by CMS: `/drugs/search` returns 25 rows whatever you ask for. */
const PAGE_SIZE = 25;
/** Eight pages. Measured at roughly a second and a half for the worst case. */
const MAX_CANDIDATES = 200;

interface RawDrug {
  rxcui?: string;
  name?: string;
  strength?: string;
  route?: string;
  full_name?: string;
}

/* ── Providers ───────────────────────────────────────────────────────────── */

export type ProviderKind = "Individual" | "Facility";

export interface ProviderHit {
  npi: string;
  name: string;
  kind: ProviderKind;
  specialties: string[];
  city: string;
  state: string;
  /** Miles from the searched ZIP, as CMS reports it. */
  distance: number | null;
}

export async function searchProviders(
  query: string,
  zip: string,
  kind: ProviderKind,
  year: number,
): Promise<ProviderHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  if (!/^\d{5}$/.test(zip)) return [];

  const data = await cmsGet<{ total?: number; providers?: RawProviderResult[] }>(
    "/providers/search",
    { q, zipcode: zip, type: kind, year: String(year) },
  );

  return (data.providers ?? []).slice(0, 40).map((row) => ({
    npi: String(row.provider?.npi ?? ""),
    name: String(row.provider?.name ?? ""),
    kind,
    specialties: (row.provider?.specialties ?? []).map(String).slice(0, 3),
    city: String(row.address?.city ?? ""),
    state: String(row.address?.state ?? ""),
    distance: typeof row.distance === "number" ? row.distance : null,
  }));
}

interface RawProviderResult {
  provider?: { npi?: string; name?: string; specialties?: unknown[] };
  address?: { city?: string; state?: string };
  distance?: number;
}

/* ── Coverage ────────────────────────────────────────────────────────────── */

/**
 * Which of these plans cover these drugs and providers.
 *
 * Batched at ten plan ids per call — CMS's limit — but the drug and provider
 * lists are unconstrained, so four medications across 85 plans is the same nine
 * calls as one medication. Measured at ~5.5s for nine.
 *
 * Batches run SEQUENTIALLY. Nine parallel calls is how a rate limit gets
 * tripped, and this already sits behind an agent tapping a button.
 */
export async function fetchCoverage(
  planIds: string[],
  rxcuis: string[],
  npis: string[],
  year: number,
): Promise<{ drugs: CoverageRow[]; providers: CoverageRow[] }> {
  const batches = batchPlanIds(planIds);
  const drugs: CoverageRow[] = [];
  const providers: CoverageRow[] = [];

  for (const batch of batches) {
    if (rxcuis.length > 0) {
      const data = await cmsGet<{ coverage?: RawDrugCoverage[] }>("/drugs/covered", {
        year: String(year),
        drugs: joinIds(rxcuis),
        planids: joinIds(batch),
      });
      for (const row of data.coverage ?? []) {
        drugs.push({
          planId: String(row.plan_id ?? ""),
          itemId: String(row.rxcui ?? ""),
          status: readStatus(row.coverage),
        });
      }
    }

    if (npis.length > 0) {
      const data = await cmsGet<{ coverage?: RawProviderCoverage[] }>("/providers/covered", {
        year: String(year),
        providerids: joinIds(npis),
        planids: joinIds(batch),
      });
      for (const row of data.coverage ?? []) {
        providers.push({
          planId: String(row.plan_id ?? ""),
          itemId: String(row.npi ?? ""),
          status: readStatus(row.coverage),
        });
      }
    }
  }

  return { drugs, providers };
}

interface RawDrugCoverage {
  plan_id?: string;
  rxcui?: string;
  coverage?: string;
}

interface RawProviderCoverage {
  plan_id?: string;
  npi?: string;
  coverage?: string;
}

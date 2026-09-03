/**
 * Drug and provider coverage, as CMS reports it.
 *
 * Pure and import-free, like coql.ts and ssn.ts, because the two rules that
 * matter here are exactly the kind that a live API will not tell you about.
 *
 * ── Rule 1: `planids` is COMMA-separated, and getting it wrong lies ──────
 * The endpoint takes `planids` as one comma-joined value. Sent the ordinary
 * way — `planids=a&planids=b&planids=c` — it returns 200 and answers for the
 * FIRST id only. Every other plan comes back with no row, which the obvious
 * reading turns into "not covered". The first attempt at this reported that a
 * client's metformin was missing from 84 of 85 plans; the truth was that 85 of
 * 85 covered it. A silent wrong answer about someone's medication is the worst
 * failure this app could have, so the encoding lives here with a test on it.
 *
 * ── Rule 2: NO ROW MEANS UNKNOWN, NEVER "NOT COVERED" ───────────────────
 * CMS answers from formulary and network files the ISSUERS publish. A plan
 * with no row has not said no — it has said nothing, and an agent must not
 * tell a client their drug is excluded on that basis. `NotCovered` is a real
 * answer; absence is not.
 *
 * ── Rule 3: "GenericCovered" is not "Covered" ───────────────────────────
 * It means the brand the client named is not on the formulary but its generic
 * equivalent is. That is good news and a different conversation — whether the
 * prescriber will substitute — so it is kept as its own state rather than
 * flattened into a tick.
 */

/** Plan ids per request. CMS rejects an eleventh: "must be between 1 and 10". */
export const MAX_PLAN_IDS = 10;

export type CoverageStatus =
  /** On the formulary / in the network. */
  | "covered"
  /** Brand not covered, its generic equivalent is. Drugs only. */
  | "generic"
  /** Explicitly excluded. */
  | "not_covered"
  /** The plan published nothing. NOT the same as excluded. */
  | "unknown";

/**
 * Split plan ids into request-sized batches.
 *
 * Every batch is then one call, whatever the number of drugs or providers —
 * `drugs` and `providerids` are not the constrained parameter, so checking
 * four medications across 85 plans costs the same nine calls as checking one.
 */
export function batchPlanIds(planIds: string[], size = MAX_PLAN_IDS): string[][] {
  const unique = [...new Set(planIds.filter((id) => id.trim() !== ""))];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    batches.push(unique.slice(i, i + size));
  }
  return batches;
}

/** The comma-joined form the endpoint actually honours. See Rule 1. */
export function joinIds(ids: string[]): string {
  return ids.join(",");
}

/** Map CMS's vocabulary onto ours, defaulting to `unknown`. */
export function readStatus(raw: unknown): CoverageStatus {
  switch (String(raw)) {
    case "Covered":
      return "covered";
    case "GenericCovered":
      return "generic";
    case "NotCovered":
      return "not_covered";
    /* The carrier filed no formulary for this plan. Named explicitly rather
     * than left to the default because it is COMMON, not exceptional: 23 of
     * 97 Georgia plans answer this way for a drug that 74 of them cover. It
     * means "no answer", exactly like a missing row — never "not covered". */
    case "DataNotProvided":
      return "unknown";
    default:
      /* Anything unrecognised is unknown rather than a guess. CMS adding a
       * value must not turn into a confident wrong answer at a kitchen table. */
      return "unknown";
  }
}

export interface CoverageRow {
  planId: string;
  /** rxcui for a drug, npi for a provider. */
  itemId: string;
  status: CoverageStatus;
}

/**
 * Build the lookup the UI needs: planId -> itemId -> status.
 *
 * Only what CMS actually returned goes in. `statusFor` supplies `unknown` for
 * everything else, so a plan missing from the response can never read as a
 * refusal — see Rule 2.
 */
export function indexCoverage(rows: CoverageRow[]): Map<string, Map<string, CoverageStatus>> {
  const byPlan = new Map<string, Map<string, CoverageStatus>>();
  for (const row of rows) {
    if (!row.planId || !row.itemId) continue;
    let items = byPlan.get(row.planId);
    if (!items) {
      items = new Map();
      byPlan.set(row.planId, items);
    }
    items.set(row.itemId, row.status);
  }
  return byPlan;
}

export function statusFor(
  index: Map<string, Map<string, CoverageStatus>>,
  planId: string,
  itemId: string,
): CoverageStatus {
  return index.get(planId)?.get(itemId) ?? "unknown";
}

/**
 * One verdict for a plan across everything the agent asked about.
 *
 * The worst state wins, and "unknown" outranks "covered": a plan that covers
 * two of a client's three medications and is silent on the third has not been
 * shown to work for them. Ranked so a filter on "covers everything" cannot
 * quietly include a plan that never answered.
 */
export function combineStatuses(statuses: CoverageStatus[]): CoverageStatus {
  if (statuses.length === 0) return "unknown";
  if (statuses.includes("not_covered")) return "not_covered";
  if (statuses.includes("unknown")) return "unknown";
  if (statuses.includes("generic")) return "generic";
  return "covered";
}

/** Wording for the agent. Never states more than CMS actually said. */
export function statusLabel(status: CoverageStatus): string {
  switch (status) {
    case "covered":
      return "On this plan";
    case "generic":
      return "Generic only";
    case "not_covered":
      return "Not on this plan";
    default:
      return "Not published";
  }
}

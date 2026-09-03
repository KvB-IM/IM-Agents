/**
 * Order drug search results by how well they answer what was typed.
 *
 * Pure and import-free, so the ordering is testable without an API key.
 *
 * ── Why this is needed ───────────────────────────────────────────────────
 * CMS returns matches in its own order, which is not relevance. Searching
 * "metformin" against the live 2026 catalogue returns 129 products whose first
 * page is ACTOPLUS MET, metFORMIN/Pioglitazone, JANUMET — combination drugs and
 * brands. Plain "metFORMIN 500 mg", which is what the agent asked for and what
 * most clients actually take, sits past the first page of 25.
 *
 * An agent reading a client's pill bottle at a kitchen table should not have to
 * page through sitagliptin combinations to find it.
 */

export interface RankableDrug {
  name: string;
  strength: string;
}

/** Lowercase, and drop the punctuation CMS varies on. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s,]+/g, "");
}

/**
 * Lower is better.
 *
 * 0  the name IS the query          "metformin"  -> metFORMIN
 * 1  the name starts with it        "metformin"  -> metFORMIN/SITagliptin
 * 2  it appears as a whole word     "met"        -> ACTOPLUS MET
 * 3  it appears anywhere            "formin"     -> metFORMIN
 * 4  matched on something else      "metformin"  -> JANUMET (via full name)
 */
export function relevanceTier(name: string, query: string): number {
  const n = normalize(name);
  const q = normalize(query);
  if (q === "") return 4;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;

  // Whole-word test on the ORIGINAL string, where the separators still exist.
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.includes(query.toLowerCase().trim())) return 2;

  if (n.includes(q)) return 3;
  return 4;
}

/**
 * The leading number in a strength, for ordering.
 *
 * "1,000 mg" must sort after "500 mg". `localeCompare` with `numeric: true`
 * gets this WRONG, because the comma stops the numeric run and it then compares
 * 1 against 5 — putting the 1,000 mg tablet first. The commas come out before
 * the number is read.
 */
function strengthValue(strength: string): number {
  const match = strength.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

/**
 * Rank, then keep the best `limit`.
 *
 * Sorted stably within a tier by name and then strength, so repeat searches
 * do not reshuffle under the agent's finger.
 */
export function rankDrugs<T extends RankableDrug>(hits: T[], query: string, limit = 40): T[] {
  return hits
    .map((hit, index) => ({ hit, index, tier: relevanceTier(hit.name, query) }))
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.hit.name.localeCompare(b.hit.name) ||
        strengthValue(a.hit.strength) - strengthValue(b.hit.strength) ||
        a.hit.strength.localeCompare(b.hit.strength) ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map((entry) => entry.hit);
}

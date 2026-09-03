/**
 * Order provider search results, nearest first.
 *
 * Pure and import-free, so the ordering is testable without an API key.
 *
 * ── Why ──────────────────────────────────────────────────────────────────
 * CMS matches provider names loosely and returns them in its own order, which
 * is not distance. Measured on live 2026 data: searching "Ban" as a facility
 * near Mesa AZ returns "Banning Dialysis" in BANNING, California — 292 miles
 * away — ahead of the Banner hospitals two miles down the road.
 *
 * The agent is holding a client's insurance card and looking for THEIR doctor.
 * Among the many people called Smith, the one six miles away is the one they
 * mean, so distance is the disambiguator and it goes first.
 *
 * ── And why the search has to be paged ──────────────────────────────────
 * "Smith" as an individual near Aiken SC reports 12,701 matches and returns 25
 * per page. Twenty-five arbitrary Smiths is not a search result. Paging a
 * bounded number and sorting by distance turns it into one, and the caller is
 * told the total so it can say "add a first name".
 */

export interface RankableProvider {
  name: string;
  /** Miles from the searched ZIP. Null when CMS did not give one. */
  distance: number | null;
}

export function rankProviders<T extends RankableProvider>(hits: T[], limit = 60): T[] {
  return hits
    .map((hit, index) => ({ hit, index }))
    .sort((a, b) => {
      /* A provider with no distance sorts LAST, not first. Null is not zero:
       * treating it as zero put unlocatable records above the clinic in the
       * client's own town. */
      const da = a.hit.distance ?? Number.POSITIVE_INFINITY;
      const db = b.hit.distance ?? Number.POSITIVE_INFINITY;
      return da - db || a.hit.name.localeCompare(b.hit.name) || a.index - b.index;
    })
    .slice(0, limit)
    .map((entry) => entry.hit);
}

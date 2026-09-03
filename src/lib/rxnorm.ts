import "server-only";

/**
 * Spelling suggestions for a drug name, from the NLM's RxNav.
 *
 * ── Why this is needed ───────────────────────────────────────────────────
 * CMS's `/drugs/search` does not tolerate a typo, and it does not reliably
 * tolerate a partial word either. Measured against the live API:
 *
 *   "ozempic"    -> 6      "ozemp"    -> 6      "ozempi"  -> 0
 *   "lipitor"    -> 4      "lipito"   -> 0      "lipit"   -> 0
 *   "metformin"  -> 129    "metformi" -> 0      "metfo"   -> 0
 *   "amoxicilin" -> 0      (one missing letter, nothing at all)
 *
 * So the behaviour is erratic for anything short of the complete, correctly
 * spelled name — which is not how anyone types a drug name onto a phone at a
 * kitchen table. RxNav is the NLM's own service over the same RxNorm
 * vocabulary CMS keys its formularies on, it is public and needs no key, and it
 * corrects exactly this.
 *
 * ── Why suggestions are never applied automatically ─────────────────────
 * "metfromin" comes back as ["merbromin", "metformin"] — merbromin FIRST.
 * Merbromin is an antiseptic dye. Silently searching for it because it topped
 * the list would answer a question about the wrong medication entirely, so the
 * suggestions are offered for the agent to choose and nothing is substituted
 * on their behalf.
 */

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
/** Short: this runs only after a search already came back empty. */
const TIMEOUT_MS = 5_000;

/**
 * Never throws and never rejects.
 *
 * A suggestion is a nicety on top of an already-empty result. If RxNav is slow
 * or down, the agent sees "nothing found", which is what they would have seen
 * anyway — it must not turn an empty search into an error.
 */
export async function spellingSuggestions(term: string): Promise<string[]> {
  const name = term.trim();
  if (name.length < 4 || name.length > 80) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `${RXNAV}/spellingsuggestions.json?name=${encodeURIComponent(name)}`,
      { signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as {
      suggestionGroup?: { suggestionList?: { suggestion?: unknown } };
    };
    const raw = body.suggestionGroup?.suggestionList?.suggestion;
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];

    return list
      .filter((s): s is string => typeof s === "string" && s.trim() !== "")
      /* Drop a suggestion that is just the query back again — it is not a
       * correction, and offering it as one is confusing when the search that
       * produced it found nothing. */
      .filter((s) => s.toLowerCase() !== name.toLowerCase())
      .slice(0, 4);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

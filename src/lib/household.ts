/**
 * Household size, derived when the agent has not set it.
 *
 * The quote step showed the person count as a PLACEHOLDER only, so the value
 * stayed null and the application step asked for it again from empty — the
 * agent typed the same number twice, or left it blank and the office chased it.
 *
 * Now it falls back to the number of people on the form, which is right in the
 * common case. It is still overridable, because household size is a TAX
 * household: it can legitimately include someone who is not applying for
 * coverage, or exclude a member who files separately.
 *
 * Pure and import-free so it is testable.
 */
export function effectiveHouseholdSize(draft: {
  householdSize: number | null;
  people: unknown[];
}): number {
  if (typeof draft.householdSize === "number" && draft.householdSize > 0) {
    return draft.householdSize;
  }
  return Math.max(1, draft.people.length);
}

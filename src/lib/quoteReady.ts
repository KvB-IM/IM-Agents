import { ageAt } from "./age.ts";
import type { CaptureDraft } from "./types.ts";

/**
 * Why the household cannot be quoted yet, or null when it can.
 *
 * Pure, so the Household step's gate is testable. Three things a quote needs
 * that the form may not have: one county (a ZIP can span several), at least
 * one person seeking coverage, and a date of birth for each of them — rates
 * are by age at the effective date.
 */
export function quoteBlocker(draft: CaptureDraft): string | null {
  if (!draft.county?.fipsCode) {
    return /^\d{5}$/.test(draft.zip) ? "Pick the county." : "A ZIP code is needed.";
  }
  const covered = draft.people.filter((p) => p.seekingCoverage);
  if (covered.length === 0) return "At least one person needs coverage.";
  const missing = covered.filter((p) => ageAt(p.dateOfBirth, draft.requestedEffective) === null);
  if (missing.length > 0) {
    return `${missing.length} ${missing.length === 1 ? "person needs" : "people need"} a date of birth before this can be quoted.`;
  }
  return null;
}

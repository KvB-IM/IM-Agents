/**
 * Age at a given date, from a date of birth.
 *
 * HealthSherpa rates on the applicant's age as of the coverage effective date,
 * not their age today — a client with a January birthday quotes differently for
 * a 1 January effective date than for 1 February. Capture stores DoB; this is
 * the only place age is derived.
 */
export function ageAt(dateOfBirth: string, onDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onDate)) return null;

  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [ey, em, ed] = onDate.split("-").map(Number);

  let age = ey - by;
  // Birthday not yet reached in the effective year.
  if (em < bm || (em === bm && ed < bd)) age -= 1;

  return age >= 0 && age <= 120 ? age : null;
}

/** The 1st of next month, which is how ACA effective dates work. */
export function defaultEffectiveDate(from = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return d.toISOString().slice(0, 10);
}

/** The next few 1st-of-month options an agent can pick from. */
export function effectiveDateOptions(count = 3, from = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1 + i, 1));
    return d.toISOString().slice(0, 10);
  });
}

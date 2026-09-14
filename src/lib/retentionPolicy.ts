/**
 * The retention rule, as a number and two predicates.
 *
 * Pure and import-free, like ssn.ts and redact.ts, so the rule is testable
 * without a database. lib/retention.ts holds the SQL that applies it; the two
 * MUST agree, and the tests on this file are what keep the number honest.
 *
 * Fifteen days is the office's figure, for both tables. db/004 originally
 * suggested thirty for submissions and seven for submitted drafts; the single
 * number is deliberate — one rule is one the office can state from memory.
 */

export const RETENTION_DAYS = 15;

const DAY_MS = 86_400_000;

/** The instant before which a settled or submitted row is purgeable. */
export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
}

/**
 * A submission row is purgeable ONLY once the CRM confirmed it and the window
 * has passed. Anything not `success` is an application that never reached the
 * CRM — the entire reason the table exists — and is never a candidate.
 */
export function isPurgeableSubmission(
  row: { zohoStatus: string; settledAt: Date | null },
  now: Date,
): boolean {
  if (row.zohoStatus !== "success") return false;
  if (!row.settledAt) return false;
  return row.settledAt.getTime() < retentionCutoff(now).getTime();
}

/**
 * A draft is purgeable on one of two clocks:
 *   * unsubmitted — when it has EXPIRED. It has no system of record behind it,
 *     so it goes on time alone; this is the one place a blanket delete is right.
 *   * submitted — RETENTION_DAYS after submission. Kept that long so a retry can
 *     find it, then dropped: the Jot has it.
 */
export function isPurgeableDraft(
  row: { submittedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  if (row.submittedAt) return row.submittedAt.getTime() < retentionCutoff(now).getTime();
  return row.expiresAt.getTime() < now.getTime();
}

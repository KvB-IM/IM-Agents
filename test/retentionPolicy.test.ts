import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RETENTION_DAYS,
  retentionCutoff,
  isPurgeableSubmission,
  isPurgeableDraft,
} from "../src/lib/retentionPolicy.ts";

/* The number the office chose, and the rule that only the CRM's copy is ever
 * deleted. lib/retention.ts mirrors these predicates in SQL. */

const NOW = new Date("2026-09-10T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

test("the window is fifteen days", () => {
  assert.equal(RETENTION_DAYS, 15);
  assert.equal(retentionCutoff(NOW).toISOString(), "2026-08-26T12:00:00.000Z");
});

test("a settled submission is purgeable only after the window", () => {
  assert.equal(isPurgeableSubmission({ zohoStatus: "success", settledAt: days(16) }, NOW), true);
  assert.equal(isPurgeableSubmission({ zohoStatus: "success", settledAt: days(14) }, NOW), false);
  // Exactly on the boundary is kept: strictly older than the cutoff goes.
  assert.equal(isPurgeableSubmission({ zohoStatus: "success", settledAt: days(15) }, NOW), false);
});

test("an unsettled submission is NEVER purgeable, however old", () => {
  for (const status of ["pending", "rejected", "error", "duplicate"]) {
    assert.equal(isPurgeableSubmission({ zohoStatus: status, settledAt: days(400) }, NOW), false, status);
  }
  assert.equal(isPurgeableSubmission({ zohoStatus: "success", settledAt: null }, NOW), false);
});

test("an unsubmitted draft goes when it expires, on time alone", () => {
  assert.equal(isPurgeableDraft({ submittedAt: null, expiresAt: days(1) }, NOW), true);
  assert.equal(isPurgeableDraft({ submittedAt: null, expiresAt: new Date(NOW.getTime() + 1) }, NOW), false);
});

test("a submitted draft goes fifteen days after submission, whatever its expiry", () => {
  // Expiry is irrelevant once submitted — the Jot is the record now.
  assert.equal(isPurgeableDraft({ submittedAt: days(16), expiresAt: new Date(NOW.getTime() + 999) }, NOW), true);
  assert.equal(isPurgeableDraft({ submittedAt: days(3), expiresAt: days(1) }, NOW), false);
});

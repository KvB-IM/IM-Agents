import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PLAN_IDS,
  batchPlanIds,
  joinIds,
  readStatus,
  indexCoverage,
  statusFor,
  combineStatuses,
  statusLabel,
  type CoverageRow,
} from "../src/lib/cmsCoverage.ts";

/**
 * These tests exist because both rules under test were learned the hard way
 * against the live API, and both fail SILENTLY — with a 200 and a plausible
 * wrong answer about somebody's medication.
 */

test("plan ids batch at ten, which is CMS's hard limit", () => {
  const ids = Array.from({ length: 85 }, (_, i) => `plan${i}`);
  const batches = batchPlanIds(ids);
  assert.equal(MAX_PLAN_IDS, 10);
  assert.equal(batches.length, 9);
  assert.ok(batches.every((b) => b.length <= 10));
  assert.equal(batches.flat().length, 85);
  // An eleventh id in any batch is a 400 from CMS: "must be between 1 and 10".
  assert.deepEqual(batches[0].length, 10);
  assert.deepEqual(batches[8].length, 5);
});

test("batching de-duplicates and drops blanks rather than wasting a slot", () => {
  assert.deepEqual(batchPlanIds(["a", "a", "", "  ", "b"]), [["a", "b"]]);
});

test("ids join with commas — the repeated-parameter form answers for one plan only", () => {
  /* `planids=a&planids=b` returns 200 and reports on `a` alone. Every other
   * plan comes back with no row, which reads as "not covered". This is the
   * whole reason the encoding is not left to a URL helper. */
  assert.equal(joinIds(["11111AZ0010001", "22222AZ0020002"]), "11111AZ0010001,22222AZ0020002");
  assert.ok(!joinIds(["a", "b"]).includes("&"));
});

test("CMS's three statuses map across, and anything else is unknown", () => {
  assert.equal(readStatus("Covered"), "covered");
  assert.equal(readStatus("GenericCovered"), "generic");
  assert.equal(readStatus("NotCovered"), "not_covered");
  // A value CMS has not used before must not become a confident answer.
  assert.equal(readStatus("CoveredWithPriorAuth"), "unknown");
  assert.equal(readStatus(undefined), "unknown");
  assert.equal(readStatus(null), "unknown");
});

test("DataNotProvided is a real, common answer and it means unknown", () => {
  /* 23 of 97 Georgia plans return this for a drug 74 of them cover. Reading it
     as an exclusion would tell a quarter of that market's clients their
     medication is off the formulary when the carrier simply filed nothing. */
  assert.equal(readStatus("DataNotProvided"), "unknown");
  assert.notEqual(readStatus("DataNotProvided"), "not_covered");
});

test("a plan CMS did not answer for is unknown, NOT not-covered", () => {
  const rows: CoverageRow[] = [{ planId: "planA", itemId: "861012", status: "covered" }];
  const index = indexCoverage(rows);
  assert.equal(statusFor(index, "planA", "861012"), "covered");
  // planB was asked about and never came back. It has not said no.
  assert.equal(statusFor(index, "planB", "861012"), "unknown");
  assert.notEqual(statusFor(index, "planB", "861012"), "not_covered");
  // A different drug on a plan that answered about another one.
  assert.equal(statusFor(index, "planA", "999999"), "unknown");
});

test("an exclusion beats everything, and silence beats a tick", () => {
  assert.equal(combineStatuses(["covered", "covered"]), "covered");
  // One exclusion decides it.
  assert.equal(combineStatuses(["covered", "not_covered", "covered"]), "not_covered");
  /* Two of three medications covered and no word on the third is NOT a plan
   * shown to work for this client — otherwise a "covers everything" filter
   * quietly includes plans that never answered. */
  assert.equal(combineStatuses(["covered", "unknown"]), "unknown");
  assert.equal(combineStatuses(["covered", "generic"]), "generic");
  assert.equal(combineStatuses(["generic", "unknown"]), "unknown");
  assert.equal(combineStatuses([]), "unknown");
});

test("generic-covered stays distinct from covered", () => {
  // The brand the client named is not on the formulary; its generic is. That is
  // a conversation with the prescriber, not a tick.
  assert.notEqual(statusLabel("generic"), statusLabel("covered"));
  assert.equal(statusLabel("generic"), "Generic only");
});

test("labels never claim more than CMS said", () => {
  assert.equal(statusLabel("covered"), "On this plan");
  assert.equal(statusLabel("not_covered"), "Not on this plan");
  // Crucially not "Not covered".
  assert.equal(statusLabel("unknown"), "Not published");
});

/* ── The canary rule ────────────────────────────────────────────────────────
 * CMS reports anything absent from a carrier's formulary file as NotCovered,
 * and files vary wildly in completeness. All 22 BlueCross BlueShield of South
 * Carolina plans call metFORMIN 500 mg NotCovered — along with every metformin
 * product except the XR 750 mg. Believing that would tell a diabetic client
 * their medication is excluded by half the market. */

import {
  CANARY_DRUGS,
  MIN_CANARIES_COVERED,
  unreliablePlans,
} from "../src/lib/cmsCoverage.ts";

const withCanaries = (
  planId: string,
  canaryStatuses: CoverageStatus[],
  extra: Record<string, CoverageStatus> = {},
) => {
  const rows: CoverageRow[] = CANARY_DRUGS.map((d, i) => ({
    planId,
    itemId: d.rxcui,
    status: canaryStatuses[i] ?? "unknown",
  }));
  for (const [itemId, status] of Object.entries(extra)) rows.push({ planId, itemId, status });
  return rows;
};

test("a plan that lists the common generics is trusted", () => {
  const index = indexCoverage(withCanaries("good", ["covered", "covered", "covered"]));
  assert.deepEqual([...unreliablePlans(index, ["good"])], []);
});

test("BCBS South Carolina's sparse formulary is flagged", () => {
  // Real measured shape: atorvastatin listed, metformin and lisinopril not.
  const index = indexCoverage(
    withCanaries("26065SC0670003", ["not_covered", "covered", "not_covered"]),
  );
  assert.deepEqual([...unreliablePlans(index, ["26065SC0670003"])], ["26065SC0670003"]);
});

test("two of three canaries is enough to be believed", () => {
  assert.equal(MIN_CANARIES_COVERED, 2);
  const index = indexCoverage(withCanaries("ok", ["covered", "covered", "not_covered"]));
  assert.deepEqual([...unreliablePlans(index, ["ok"])], []);
});

test("a generic-covered canary counts as listed", () => {
  const index = indexCoverage(withCanaries("g", ["generic", "generic", "not_covered"]));
  assert.deepEqual([...unreliablePlans(index, ["g"])], []);
});

test("a plan that published NOTHING is not called unreliable — it is unknown", () => {
  /* Otherwise "no data" acquires a second, more alarming name for the same
     situation. Georgia's DataNotProvided plans land here. */
  const index = indexCoverage(withCanaries("silent", ["unknown", "unknown", "unknown"]));
  assert.deepEqual([...unreliablePlans(index, ["silent"])], []);
  const absent = indexCoverage([]);
  assert.deepEqual([...unreliablePlans(absent, ["never-answered"])], []);
});

test("an unreliable answer outranks a tick, so the filter cannot include it", () => {
  assert.equal(combineStatuses(["covered", "unreliable"]), "unreliable");
  assert.equal(combineStatuses(["unreliable", "unknown"]), "unreliable");
  // A real exclusion from a trustworthy plan still wins.
  assert.equal(combineStatuses(["unreliable", "not_covered"]), "not_covered");
});

test("the unreliable label blames the carrier's list, not the drug", () => {
  const label = statusLabel("unreliable");
  assert.match(label, /list/i);
  // It must not read as a refusal.
  assert.ok(!/not on this plan/i.test(label));
  assert.notEqual(label, statusLabel("not_covered"));
});

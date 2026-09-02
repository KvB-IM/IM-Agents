import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSsns, bufferDate } from "../src/lib/redact.ts";

/*
 * The replay buffer stores the payload so a rejected submission can be
 * replayed. It must NOT store a second complete copy of every SSN — that is a
 * larger standing liability than the recovery it buys, and the SSN is the one
 * field re-collectable from the client.
 *
 * A bug here writes full SSNs into a second system silently, so it gets tests.
 */

test("the parent SSN is reduced to its last four digits", () => {
  const out = redactSsns({ First_Name: "Marisol", SSN: "412-88-9031" });
  assert.equal(out.SSN, undefined, "full SSN must not survive");
  assert.equal(out.SSN_last4, "9031");
  assert.equal(out.First_Name, "Marisol", "other fields pass through");
});

test("every dependent's SSN is reduced too", () => {
  const out = redactSsns({
    SSN: "412889031",
    Jot_Dependents: [
      { First: "Camila", SSN: "655-21-7744", Relation: "Child" },
      { First: "Jonah", SSN: "111223333", Relation: "Spouse" },
    ],
  });
  const deps = out.Jot_Dependents as Array<Record<string, unknown>>;
  assert.equal(deps.length, 2);
  for (const d of deps) {
    assert.equal(d.SSN, undefined, "a dependent's full SSN survived");
  }
  assert.equal(deps[0].SSN_last4, "7744");
  assert.equal(deps[1].SSN_last4, "3333");
  // Non-SSN subform columns are untouched.
  assert.equal(deps[0].Relation, "Child");
  assert.equal(deps[1].First, "Jonah");
});

test("no full nine-digit run survives anywhere in the output", () => {
  // The property that actually matters, checked over the serialised form rather
  // than field by field — a future field named something else would be caught.
  const out = redactSsns({
    SSN: "412-88-9031",
    Jot_Dependents: [{ SSN: "655217744" }],
  });
  const json = JSON.stringify(out);
  assert.ok(!json.includes("412889031") && !json.includes("412-88-9031"), "parent leaked");
  assert.ok(!json.includes("655217744") && !json.includes("655-21-7744"), "dependent leaked");
});

test("a missing or partial SSN produces no last4 key at all", () => {
  assert.equal(redactSsns({ SSN: "" }).SSN_last4, undefined);
  assert.equal(redactSsns({ SSN: "41" }).SSN_last4, undefined);
  assert.equal(redactSsns({}).SSN_last4, undefined);
  // An attested "no SSN" record carries no number to reduce.
  const out = redactSsns({ No_SSN_Attestation: true, Last_Name: "Vega" });
  assert.equal(out.No_SSN_Attestation, true);
  assert.equal(out.SSN_last4, undefined);
});

test("a malformed dependents value is passed through rather than crashing", () => {
  // The buffer must never be the reason a submission fails.
  assert.deepEqual(redactSsns({ Jot_Dependents: [] }).Jot_Dependents, []);
  assert.deepEqual(redactSsns({ Jot_Dependents: [null] }).Jot_Dependents, [null]);
  assert.equal(redactSsns({ Jot_Dependents: "not an array" }).Jot_Dependents, "not an array");
});

/*
 * The buffer's own schema must not be able to reject the data it exists to
 * preserve. A submission carrying "2026-13-45" — exactly the malformed value
 * the CRM refuses — also broke the buffer's typed `date` column, so the safety
 * net failed in the one scenario it was built for.
 */
test("bufferDate accepts a real date and nulls anything Postgres would refuse", () => {
  assert.equal(bufferDate("2026-11-01"), "2026-11-01");
  assert.equal(bufferDate("2026-02-28"), "2026-02-28");

  // The value that actually caused the failure.
  assert.equal(bufferDate("2026-13-45"), null);
  assert.equal(bufferDate("2026-02-30"), null, "impossible day in a real month");
  assert.equal(bufferDate("2026-00-10"), null);
  assert.equal(bufferDate("2026-11-32"), null);
  assert.equal(bufferDate("11/01/2026"), null, "wrong format");
  assert.equal(bufferDate(""), null);
  assert.equal(bufferDate(null), null);
  assert.equal(bufferDate(undefined), null);
  assert.equal(bufferDate(20261101), null, "not a string");
});

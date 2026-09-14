import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSsns, mergeSsns, heldKeys } from "../src/lib/draftSsn.ts";
import type { CaptureDraft, Person } from "../src/lib/types.ts";

/* A bug here stores a full SSN in the jsonb column or drops one on resume —
 * neither has any symptom at write time. */

function person(over: Partial<Person> = {}): Person {
  return {
    key: "p1", relation: "primary", firstName: "Ada", lastName: "Byron",
    dateOfBirth: "1980-05-10", sex: "Female", tobacco: false, pregnant: "No",
    ssn: "529841063", ssnConfirm: "529841063", noSsn: false, seekingCoverage: true,
    ...over,
  };
}
const draft = (people: Person[]) => ({ id: "d", people } as unknown as CaptureDraft);

test("split takes complete SSNs out of the payload and keys them by person", () => {
  const { payload, ssns } = splitSsns(draft([person(), person({ key: "p2", ssn: "601234567", ssnConfirm: "601234567" })]));
  assert.deepEqual(ssns, { p1: "529841063", p2: "601234567" });
  for (const p of payload.people) {
    assert.equal(p.ssn, "");
    assert.equal(p.ssnConfirm, "");
  }
  assert.ok(!JSON.stringify(payload).includes("529841063"), "payload leaked an SSN");
});

test("a partial SSN is neither stored nor kept in the payload", () => {
  const { payload, ssns } = splitSsns(draft([person({ ssn: "52984", ssnConfirm: "" })]));
  assert.deepEqual(ssns, {});
  assert.equal(payload.people[0].ssn, "");
});

test("an attested never-issued SSN is not held even if digits linger", () => {
  const { ssns } = splitSsns(draft([person({ noSsn: true })]));
  assert.deepEqual(ssns, {});
});

test("merge fills only blanks", () => {
  const d = draft([person({ ssn: "", ssnConfirm: "" }), person({ key: "p2", ssn: "601234567", ssnConfirm: "601234567" })]);
  const out = mergeSsns(d, { p1: "529841063", p2: "999999999" });
  assert.equal(out.people[0].ssn, "529841063");
  assert.equal(out.people[0].ssnConfirm, "529841063");
  // Typed wins over held.
  assert.equal(out.people[1].ssn, "601234567");
});

test("merge never overrides a never-issued attestation", () => {
  const out = mergeSsns(draft([person({ noSsn: true, ssn: "", ssnConfirm: "" })]), { p1: "529841063" });
  assert.equal(out.people[0].ssn, "");
  assert.equal(out.people[0].noSsn, true);
});

test("merge with nothing held is the identity", () => {
  const d = draft([person({ ssn: "", ssnConfirm: "" })]);
  assert.deepEqual(mergeSsns(d, {}), d);
});

test("heldKeys reports only complete numbers", () => {
  assert.deepEqual(heldKeys({ a: "529841063", b: "1234", c: "" }), ["a"]);
});

test("split then merge round-trips", () => {
  const original = draft([person(), person({ key: "p2", relation: "spouse", ssn: "601234567", ssnConfirm: "601234567" })]);
  const { payload, ssns } = splitSsns(original);
  const back = mergeSsns(payload, ssns);
  assert.deepEqual(back.people.map((p) => p.ssn), ["529841063", "601234567"]);
});

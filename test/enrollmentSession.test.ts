import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FLOW, draftToEnrollmentSession } from "../src/lib/enrollmentSessionPayload.ts";
import * as PL from "../src/lib/picklists.ts";
import type { CaptureDraft, Person } from "../src/lib/types.ts";

/**
 * The HealthSherpa enrollment-session payload.
 *
 * These tests are the ONLY check this payload gets: the account is not
 * authorized for `/v1/enrollment-sessions` yet, so nothing here has ever been
 * accepted by HealthSherpa. And the spec rejects the whole request with
 * `400 invalid_request` for a single unsupported key rather than ignoring it,
 * so "what is in the body" is exactly the thing worth pinning.
 */

function person(over: Partial<Person> = {}): Person {
  return {
    key: "p1",
    relation: "primary",
    firstName: "Ada",
    lastName: "Byron",
    dateOfBirth: "1980-05-10",
    sex: "Female",
    tobacco: false,
    pregnant: "No",
    ssn: "529841063",
    ssnConfirm: "529841063",
    noSsn: false,
    seekingCoverage: true,
    ...over,
  };
}

function draft(over: Partial<CaptureDraft> = {}): CaptureDraft {
  return {
    id: "d1",
    updatedAt: "2026-09-08T00:00:00Z",
    zip: "85201",
    county: { fipsCode: "04013", name: "Maricopa", state: "AZ" },
    street: "1 Main St",
    city: "Mesa",
    mailingSameAsHome: true,
    mailingStreet: "",
    mailingCity: "",
    mailingState: "",
    mailingZip: "",
    wantsCostSavings: "Yes",
    medicareEnrolledOrSoon: "No",
    claimedAsDependent: "No",
    caresForUnder19: "No",
    everyoneSameAddress: "Yes",
    people: [person()],
    householdSize: 1,
    householdIncome: 40000,
    employmentIncome: 40000,
    spouseEmploymentIncome: null,
    otherIncome: null,
    employer: "Acme",
    email: "ada@example.com",
    phone: "4805550000",
    homePhone: "",
    usCitizen: "Yes",
    naturalizedOrDerived: "No",
    incarcerated: "No",
    americanIndianAkNative: "No",
    medicaidChipDenied90d: "No",
    employerCoverageOffer: "No",
    unemployment: "No",
    parentCaretaker: "No",
    preferredLanguage: "English",
    ichraStatus: "No ICHRA",
    form8962Filed: "Yes",
    willFileTaxes: "Yes",
    fileJointly: "No",
    existingCoverage: "No",
    typeOfExistingCoverage: "",
    coverageLossDate: "",
    enrollmentType: "Open Enrollment",
    enrollmentEvent: "",
    qualifyingEventDate: "",
    requestedEffective: "2026-10-01",
    selectedPlan: null,
    photoId: null,
    ...over,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const body = (d: CaptureDraft, formId = "AP-DEADBEEFDEADBEEF") =>
  draftToEnrollmentSession(d, formId) as any;

test("the context is the on-exchange shape, in the default flow", () => {
  const ctx = body(draft()).context;
  assert.equal(ctx.product, "aca");
  assert.equal(ctx.exchange, "on_exchange");
  assert.equal(ctx.coverage_family, "medical");
  assert.equal(ctx.coverage_type, "medical");
  assert.equal(ctx.locale, "en-US");
  assert.equal(ctx.flow, DEFAULT_FLOW);
});

test("plan_year comes from the requested effective date", () => {
  assert.equal(body(draft({ requestedEffective: "2027-01-01" })).context.plan_year, 2027);
  // A number, not a string: the spec types it as an integer.
  assert.equal(typeof body(draft()).context.plan_year, "number");
});

test("no plan chosen means no plan_id, and the campaign block is never sent", () => {
  assert.ok(!("plan_id" in body(draft())));
  assert.ok(!("campaign" in body(draft())));
});

test("no SSN reaches HealthSherpa's session, at any depth", () => {
  /* The endpoint has no SSN field anywhere in its schema, and the draft is
   * carrying a real one for the Jot. This scans the serialised payload rather
   * than named keys, so a future field that happens to carry the digits along
   * is caught too. */
  const serialised = JSON.stringify(body(draft({ people: [person(), person({ key: "p2" })] })));
  assert.ok(!serialised.includes("529841063"), "raw digits leaked");
  assert.ok(!serialised.includes("529-84-1063"), "dashed SSN leaked");
  assert.ok(!/ssn/i.test(serialised), "an SSN-shaped key leaked");
});

test("the form ID is the external_id, so both systems share one identifier", () => {
  assert.equal(body(draft(), "AP-0123456789ABCDEF").external_id, "AP-0123456789ABCDEF");
});

test("sex is lowercased for HealthSherpa, not passed through as Zoho's form", () => {
  const [a] = body(draft({ people: [person({ sex: "Female" })] })).household.applicants;
  assert.equal(a.sex, "female");
  const [b] = body(draft({ people: [person({ sex: "Male" })] })).household.applicants;
  assert.equal(b.sex, "male");
  // Unanswered is omitted rather than guessed.
  const [c] = body(draft({ people: [person({ sex: "" })] })).household.applicants;
  assert.ok(!("sex" in c));
});

test("only people seeking coverage are applicants", () => {
  const d = draft({
    people: [person(), person({ key: "p2", relation: "child", seekingCoverage: false })],
  });
  assert.equal(body(d).household.applicants.length, 1);
});

test("at most one primary and one spouse; extras demote to dependent", () => {
  // Otherwise the whole call fails: the spec permits one of each.
  const d = draft({
    people: [
      person({ key: "a", relation: "primary" }),
      person({ key: "b", relation: "primary" }),
      person({ key: "c", relation: "spouse" }),
      person({ key: "d", relation: "spouse" }),
      person({ key: "e", relation: "child" }),
    ],
  });
  const rels = body(d).household.applicants.map((a: any) => a.relationship);
  assert.deepEqual(rels, ["primary", "dependent", "spouse", "dependent", "dependent"]);
});

test("email and phone go on the primary applicant only (agent-assisted)", () => {
  const d = draft({
    people: [person({ key: "a" }), person({ key: "b", relation: "spouse" })],
  });
  const [primary, spouse] = (draftToEnrollmentSession(d, "AP-X", "agent_assisted") as any)
    .household.applicants;
  assert.equal(primary.email, "ada@example.com");
  assert.equal(primary.phone_number, "4805550000");
  assert.ok(!("email" in spouse));
  assert.ok(!("phone_number" in spouse));
});

test("names ride along in the agent-assisted flow", () => {
  const [a] = (draftToEnrollmentSession(draft(), "AP-X", "agent_assisted") as any)
    .household.applicants;
  assert.equal(a.first_name, "Ada");
  assert.equal(a.last_name, "Byron");
});

test("date of birth is sent and age is not, since they are mutually exclusive", () => {
  const [a] = body(draft()).household.applicants;
  assert.equal(a.date_of_birth, "1980-05-10");
  assert.ok(!("age" in a));
});

test('"not sure" answers are omitted, never sent as false', () => {
  /* Sending false is an assertion the agent never made, and these answers
   * change the Medicaid/CHIP screening path. */
  const d = draft({
    employerCoverageOffer: "Unknown",
    people: [person({ pregnant: "N/A" })],
  });
  const out = body(d);
  assert.ok(!("someone_has_employer_coverage" in out.household));
  assert.ok(!("pregnant" in out.household.applicants[0]));

  const answered = body(draft({ employerCoverageOffer: "Yes", people: [person({ pregnant: "Yes" })] }));
  assert.equal(answered.household.someone_has_employer_coverage, true);
  assert.equal(answered.household.applicants[0].pregnant, true);
  const no = body(draft({ employerCoverageOffer: "No" }));
  assert.equal(no.household.someone_has_employer_coverage, false);
});

test("household size falls back to the people on the form", () => {
  const d = draft({ householdSize: null, people: [person(), person({ key: "p2" })] });
  assert.equal(body(d).household.household_size, 2);
});

test("location carries the county FIPS the quote was priced on", () => {
  const loc = body(draft()).location;
  assert.deepEqual(loc, { zip_code: "85201", fips_code: "04013", state: "AZ" });
});

/* ── Form_Type ─────────────────────────────────────────────────────────────
 * The one field that differs between the two enrollment paths. Both values
 * were verified against live JOTS metadata; "Agent Portal", which this app
 * used to send, is not an option and was being silently dropped. */

test("both enrollment paths pin to a real Form_Type option", () => {
  assert.equal(PL.pinned(PL.FORM_TYPE, PL.FORM_TYPE_OFFICE), "Full Form - Needs Enrollment");
  assert.equal(
    PL.pinned(PL.FORM_TYPE, PL.FORM_TYPE_HEALTHSHERPA),
    "Full Form - Enrolled In Feild",
  );
});

test('the "Feild" misspelling is Zoho\'s and must not be corrected', () => {
  // Spelling it properly puts the value off-list, and Zoho drops an off-list
  // picklist value silently with a 2xx. This test exists to fail the fix.
  assert.equal(PL.pinned(PL.FORM_TYPE, "Full Form - Enrolled In Field"), "");
});

test("the value this app used to send is still not an option", () => {
  assert.equal(PL.pinned(PL.FORM_TYPE, "Agent Portal"), "");
});

/* ── The rest of what the session accepts ──────────────────────────────────
 * Everything HealthSherpa takes is captured on step 1 now, so these guard the
 * mapping from a flat, household-level draft onto a per-applicant schema. */

test("locale switches HealthSherpa into its Spanish flow", () => {
  assert.equal(body(draft({ preferredLanguage: "Spanish" })).context.locale, "es-MX");
  assert.equal(body(draft({ preferredLanguage: "English" })).context.locale, "en-US");
  // Unanswered defaults to English rather than guessing.
  assert.equal(body(draft({ preferredLanguage: "" })).context.locale, "en-US");
});

test("household-level eligibility answers ride on the primary only", () => {
  /* The schema is per applicant; the draft holds one answer each, because
   * Jot_Dependents has no column for them. Asserting them onto everyone would
   * claim things about people who were never asked. */
  const d = draft({
    medicaidChipDenied90d: "Yes",
    unemployment: "No",
    parentCaretaker: "Yes",
    existingCoverage: "Yes",
    people: [person({ key: "a" }), person({ key: "b", relation: "spouse" })],
  });
  const [primary, spouse] = body(d).household.applicants;
  assert.equal(primary.rejected_by_medicaid_or_chip, true);
  assert.equal(primary.unemployment, false);
  assert.equal(primary.parent_caretaker, true);
  assert.equal(primary.has_existing_coverage, true);
  for (const k of [
    "rejected_by_medicaid_or_chip",
    "unemployment",
    "parent_caretaker",
    "has_existing_coverage",
  ]) {
    assert.ok(!(k in spouse), `${k} should not be asserted of the spouse`);
  }
});

test('"not sure" on an eligibility answer is omitted, not sent as false', () => {
  const [a] = body(draft({ medicaidChipDenied90d: "Unknown" })).household.applicants;
  assert.ok(!("rejected_by_medicaid_or_chip" in a));
});

test("income sources go to whoever earned them", () => {
  const d = draft({
    employmentIncome: 40000,
    employer: "Acme",
    otherIncome: 5000,
    spouseEmploymentIncome: 22000,
    people: [person({ key: "a" }), person({ key: "b", relation: "spouse" })],
  });
  const [primary, spouse] = body(d).household.applicants;
  assert.deepEqual(primary.income_sources, [
    { amount: 40000, employer: "Acme" },
    { amount: 5000 },
  ]);
  assert.deepEqual(spouse.income_sources, [{ amount: 22000 }]);
});

test("zero and blank income sources are dropped, since amount is required", () => {
  const d = draft({ employmentIncome: 0, otherIncome: null, employer: "" });
  const [a] = body(d).household.applicants;
  assert.ok(!("income_sources" in a), "an empty sources array would fail the request");
});

test("a dependent carries no household answers and no income", () => {
  const d = draft({
    medicaidChipDenied90d: "Yes",
    employmentIncome: 40000,
    people: [person({ key: "a" }), person({ key: "c", relation: "child" })],
  });
  const [, child] = body(d).household.applicants;
  assert.equal(child.relationship, "dependent");
  assert.ok(!("income_sources" in child));
  assert.ok(!("rejected_by_medicaid_or_chip" in child));
});

test("still no SSN, now that far more of the draft is mapped", () => {
  const d = draft({
    medicaidChipDenied90d: "Yes", unemployment: "Yes", parentCaretaker: "Yes",
    existingCoverage: "Yes", preferredLanguage: "Spanish",
    employmentIncome: 40000, employer: "Acme", otherIncome: 5000,
    people: [person(), person({ key: "b", relation: "spouse" })],
  });
  const serialised = JSON.stringify(body(d));
  assert.ok(!serialised.includes("529841063"));
  assert.ok(!/ssn/i.test(serialised));
});


/* ── The two flows ─────────────────────────────────────────────────────────
 * Both verified live 2026-09-08. The field sets are MUTUALLY exclusive in the
 * places that matter, and an unsupported key fails the whole request. */

const plan = {
  planId: "26065SC0670003", planName: "Blue VirtuConnect Bronze 1",
  carrier: "BCBS SC", metalLevel: "Bronze", planHiosId: "26065SC0670003",
  carrierHiosId: "26065", premium: 297, aptc: 0, netPremium: 297,
  deductible: null, moop: null, deductibleFamily: null, moopFamily: null,
  primaryCare: "", specialist: "", urgentCare: "", genericRx: "",
  isStandardized: false, networkName: "", sbcUrl: "", formularyUrl: "",
  networkUrl: "", brochureUrl: "", issuerPhone: "", ratingArea: "", releaseId: "",
};
const ss = (d: CaptureDraft) => draftToEnrollmentSession(d, "AP-X", "self_service") as any;
const aa = (d: CaptureDraft) => draftToEnrollmentSession(d, "AP-X", "agent_assisted") as any;

test("the flow argument is what goes on the wire", () => {
  assert.equal(ss(draft()).context.flow, "self_service");
  assert.equal(aa(draft()).context.flow, "agent_assisted");
  assert.equal(body(draft()).context.flow, DEFAULT_FLOW);
});

test("self-service carries the quoted plan; agent-assisted must not", () => {
  const d = draft({ selectedPlan: plan });
  assert.equal(ss(d).plan_id, "26065SC0670003");
  assert.ok(!("plan_id" in aa(d)), "plan_id 400s the agent-assisted flow");
  // No plan chosen yet: nothing to send, not an empty string.
  assert.ok(!("plan_id" in ss(draft({ selectedPlan: null }))));
});

test("self-service carries no names or contact details", () => {
  const d = draft({ people: [person({ key: "a" }), person({ key: "b", relation: "spouse" })] });
  for (const a of ss(d).household.applicants) {
    for (const k of ["first_name", "last_name", "email", "phone_number"]) {
      assert.ok(!(k in a), `${k} is agent-assisted only`);
    }
  }
  // The eligibility and income mapping is flow-independent.
  const [primary] = ss(draft({ medicaidChipDenied90d: "Yes", employmentIncome: 1000 })).household.applicants;
  assert.equal(primary.rejected_by_medicaid_or_chip, true);
  assert.deepEqual(primary.income_sources, [{ amount: 1000, employer: "Acme" }]);
});

test("agent-assisted still carries names and primary contact", () => {
  const [a] = aa(draft()).household.applicants;
  assert.equal(a.first_name, "Ada");
  assert.equal(a.email, "ada@example.com");
});

test("no SSN in either flow", () => {
  const d = draft({ selectedPlan: plan, people: [person(), person({ key: "b", relation: "spouse" })] });
  for (const out of [ss(d), aa(d)]) {
    const t = JSON.stringify(out);
    assert.ok(!t.includes("529841063") && !/ssn/i.test(t));
  }
});

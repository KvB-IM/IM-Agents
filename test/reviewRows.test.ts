import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSections } from "../src/lib/reviewRows.ts";
import type { CaptureDraft, Person } from "../src/lib/types.ts";

/**
 * The review screen's job is to let an agent catch a wrong answer before it is
 * filed. A field that is not rendered cannot be caught, so the tests that
 * matter are about COVERAGE — every answer present, and every blank reported.
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

function fullDraft(over: Partial<CaptureDraft> = {}): CaptureDraft {
  return {
    id: "d1",
    updatedAt: "2026-09-03T00:00:00Z",
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
    email: "a@example.com",
    phone: "4805550000",
    homePhone: "",
    usCitizen: "Yes",
    naturalizedOrDerived: "No",
    incarcerated: "No",
    americanIndianAkNative: "No",
    medicaidChipDenied90d: "No",
    employerCoverageOffer: "No",
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
    selectedPlan: {
      planId: "1",
      planName: "Silver Standard",
      carrier: "Imperial",
      metalLevel: "Silver",
      planHiosId: "x",
      carrierHiosId: "y",
      premium: 1435,
      aptc: 900,
      netPremium: 535,
      deductible: 5000,
      moop: 9200,
    },
    photoId: { url: "https://x.blob.vercel-storage.com/staged/licenses/a.jpg", filename: "a.jpg", bytes: 1 },
    ...over,
  };
}

const labels = (d: CaptureDraft) => buildSections(d).flatMap((s) => s.rows.map((r) => r.label));
const missing = (d: CaptureDraft) => buildSections(d).flatMap((s) => s.rows).filter((r) => r.missing);

test("a complete capture reports nothing unanswered", () => {
  assert.deepEqual(missing(fullDraft()).map((r) => r.label), []);
});

test("every step is represented, so Edit can reach all of them", () => {
  const steps = new Set(buildSections(fullDraft()).map((s) => s.step));
  assert.deepEqual([...steps].sort(), [0, 1, 2, 3, 4, 5]);
});

test("each person on the form gets their own section", () => {
  const d = fullDraft({
    people: [
      person({ key: "a", firstName: "Ada" }),
      person({ key: "b", relation: "spouse", firstName: "Paul", sex: "Male" }),
      person({ key: "c", relation: "child", firstName: "Nina" }),
    ],
  });
  const titles = buildSections(d).map((s) => s.title);
  assert.ok(titles.includes("Primary · Ada Byron"));
  assert.ok(titles.includes("Spouse · Paul Byron"));
  assert.ok(titles.includes("Child · Nina Byron"));
});

test("the SSN is shown as last four only, never in full", () => {
  const rows = buildSections(fullDraft()).flatMap((s) => s.rows);
  const ssn = rows.find((r) => r.label === "SSN");
  assert.equal(ssn?.value, "•••-••-1063");
  const rendered = rows.map((r) => `${r.label}${r.value}`).join("|");
  assert.ok(!rendered.includes("529841063"), "full SSN must not appear anywhere on review");
});

test("an attested no-SSN reads as attested rather than missing", () => {
  const d = fullDraft({ people: [person({ noSsn: true, ssn: "", ssnConfirm: "" })] });
  const ssn = buildSections(d).flatMap((s) => s.rows).find((r) => r.label === "SSN");
  assert.equal(ssn?.value, "Never issued — attested");
  assert.equal(ssn?.missing, undefined);
});

test("SSN is not asked of someone who is not seeking coverage", () => {
  const d = fullDraft({ people: [person({ seekingCoverage: false, ssn: "", ssnConfirm: "" })] });
  assert.ok(!labels(d).includes("SSN"));
  assert.deepEqual(missing(d).map((r) => r.label), []);
});

test("blank eligibility answers are each reported", () => {
  const d = fullDraft({ incarcerated: "", wantsCostSavings: "", caresForUnder19: "" });
  const found = missing(d).map((r) => r.label);
  assert.ok(found.includes("Currently incarcerated"));
  assert.ok(found.includes("Wants to check for cost savings"));
  assert.ok(found.includes("Cares for a child under 19 not on this form"));
});

test("optional fields left blank are not reported as unanswered", () => {
  const d = fullDraft({ homePhone: "", employer: "", otherIncome: null, coverageLossDate: "" });
  assert.deepEqual(missing(d).map((r) => r.label), []);
});

test("SEP details are only reviewed when the enrollment is a SEP", () => {
  assert.ok(!labels(fullDraft()).includes("Qualifying event"));
  const sep = fullDraft({ enrollmentType: "Special Enrollment" });
  const found = missing(sep).map((r) => r.label);
  assert.ok(found.includes("Qualifying event"));
  assert.ok(found.includes("Event date"));
});

test("existing-coverage type is only reviewed when they have coverage", () => {
  assert.ok(!labels(fullDraft()).includes("Type of coverage"));
  const has = fullDraft({ existingCoverage: "Yes", typeOfExistingCoverage: "" });
  assert.ok(missing(has).map((r) => r.label).includes("Type of coverage"));
});

test("a mailing address that differs is reviewed field by field", () => {
  const d = fullDraft({ mailingSameAsHome: false, mailingStreet: "PO Box 4", mailingCity: "Mesa", mailingState: "AZ", mailingZip: "85201" });
  const mail = buildSections(d).find((s) => s.title === "Mailing address");
  assert.deepEqual(mail?.rows.map((r) => r.value), ["PO Box 4", "Mesa", "AZ", "85201"]);
});

test("income sources that exceed the household total are flagged", () => {
  const d = fullDraft({ householdIncome: 40000, employmentIncome: 44000, spouseEmploymentIncome: 21000 });
  const row = buildSections(d).flatMap((s) => s.rows).find((r) => r.label === "Annual household income");
  assert.match(String(row?.warn), /more than the household total/);
});

test("sources below the total are not flagged — a total need not be itemised", () => {
  const d = fullDraft({ householdIncome: 68000, employmentIncome: 44000 });
  const row = buildSections(d).flatMap((s) => s.rows).find((r) => r.label === "Annual household income");
  assert.equal(row?.warn, undefined);
});

test("a date of birth is shown with the derived age, which is how a mistyped year is caught", () => {
  const row = buildSections(fullDraft()).flatMap((s) => s.rows).find((r) => r.label === "Date of birth");
  assert.equal(row?.value, "1980-05-10 · age 46");
});

test("becoming a citizen later carries the document warning onto the review", () => {
  const d = fullDraft({ naturalizedOrDerived: "Yes" });
  const row = buildSections(d).flatMap((s) => s.rows).find((r) => r.label === "Citizenship");
  assert.equal(row?.value, "Became a citizen later");
  assert.match(String(row?.warn), /citizenship document/);
});

test("everyone-lives-here is only asked when more than one person is on the form", () => {
  assert.ok(!labels(fullDraft()).includes("Everyone applying lives here"));
  const two = fullDraft({ people: [person(), person({ key: "b", relation: "spouse" })] });
  assert.ok(labels(two).includes("Everyone applying lives here"));
});

test("a missing license photo is noted without being counted as an unanswered question", () => {
  const d = fullDraft({ photoId: null });
  const row = buildSections(d).flatMap((s) => s.rows).find((r) => r.label === "License photo");
  assert.equal(row?.value, "None taken");
  assert.deepEqual(missing(d).map((r) => r.label), []);
});

test("an empty capture reports a lot rather than looking complete", () => {
  const empty = fullDraft({
    street: "", city: "", zip: "", county: null, email: "", phone: "",
    householdSize: null, householdIncome: null, willFileTaxes: "", fileJointly: "",
    usCitizen: "", naturalizedOrDerived: "", incarcerated: "", americanIndianAkNative: "",
    wantsCostSavings: "", medicareEnrolledOrSoon: "", claimedAsDependent: "",
    caresForUnder19: "", medicaidChipDenied90d: "", existingCoverage: "",
    enrollmentType: "", employerCoverageOffer: "", ichraStatus: "", form8962Filed: "",
    people: [person({ firstName: "", lastName: "", dateOfBirth: "", sex: "", ssn: "", ssnConfirm: "", pregnant: "" })],
  });
  assert.ok(missing(empty).length >= 20, `expected many unanswered, got ${missing(empty).length}`);
});

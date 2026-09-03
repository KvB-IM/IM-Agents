/**
 * Every captured answer, as rows for the review screen.
 *
 * Pure and free of React, like coql.ts and ssn.ts, so the thing that actually
 * matters here is testable: that a field added to the draft cannot quietly fail
 * to appear on review. The first review screen showed twelve rows out of the
 * ninety-odd answers a capture holds, which is a receipt rather than a review —
 * an agent reading answers back to a client cannot catch a wrong one that is
 * not on the screen.
 *
 * Blanks are reported rather than rendered as empty cells: an empty cell reads
 * as intentional, and "not answered" is the thing worth seeing.
 */

import { money, monthYear } from "./format.ts";
import { ssnSummary } from "./ssn.ts";
import { ageAt } from "./age.ts";
import { effectiveHouseholdSize } from "./household.ts";
import type { CaptureDraft, Person } from "./types.ts";

export interface Row {
  label: string;
  value: string;
  /** Expected and absent — rendered in amber and counted at the top. */
  missing?: boolean;
  /** Present but worth a second look. */
  warn?: string;
}

export interface Section {
  title: string;
  /** Which stepper step to return to. */
  step: number;
  rows: Row[];
}

/* ── Row builders ─────────────────────────────────────────────────────────
 * `req` marks a row the exchange expects an answer to; `opt` marks one that is
 * legitimately blank a lot of the time (a second phone, an employer for someone
 * self-employed) and must NOT be counted as missing — a review that cries wolf
 * on optional fields is one an agent stops reading. */

const req = (label: string, value: string | null | undefined, warn?: string): Row =>
  value === null || value === undefined || String(value).trim() === ""
    ? { label, value: "", missing: true }
    : { label, value: String(value), warn };

const opt = (label: string, value: string | null | undefined): Row => ({
  label,
  value: value === null || value === undefined || String(value).trim() === "" ? "—" : String(value),
});

const yesNo = (b: boolean): string => (b ? "Yes" : "No");

function relationLabel(p: Person): string {
  return { primary: "Primary", spouse: "Spouse", child: "Child", other: "Other" }[p.relation];
}

function personName(p: Person): string {
  return [p.firstName, p.lastName].filter(Boolean).join(" ");
}

export function buildSections(draft: CaptureDraft): Section[] {
  const sections: Section[] = [];

  // ── Everyone on the form ───────────────────────────────────────────────
  for (const [i, person] of draft.people.entries()) {
    const rows: Row[] = [
      req("Name", personName(person)),
      req("Date of birth", person.dateOfBirth ? dobWithAge(person, draft) : ""),
      req("Sex", person.sex),
      { label: "Needs coverage", value: yesNo(person.seekingCoverage) },
      { label: "Uses tobacco", value: yesNo(person.tobacco) },
    ];

    /* SSN only for someone actually seeking coverage — a household member on
     * the form for tax purposes does not need one, so requiring it would flag
     * a form that is complete. */
    if (person.seekingCoverage) {
      rows.push(
        person.noSsn
          ? { label: "SSN", value: "Never issued — attested" }
          : req("SSN", ssnSummary(person.ssn)),
      );
    }

    // Asked of every female applicant seeking coverage, so reviewed the same way.
    if (person.sex === "Female" && person.seekingCoverage) {
      rows.push(req("Pregnant", person.pregnant));
    }

    sections.push({
      title: `${relationLabel(person)}${personName(person) ? ` · ${personName(person)}` : ` ${i + 1}`}`,
      step: 0,
      rows,
    });
  }

  // ── Home address ───────────────────────────────────────────────────────
  const homeRows: Row[] = [
    req("Street", draft.street),
    req("City", draft.city),
    { label: "ZIP", value: draft.zip || "—", missing: !draft.zip },
    req("County", draft.county ? `${draft.county.name}, ${draft.county.state}` : ""),
  ];
  // Only meaningful with more than one person on the form.
  if (draft.people.length > 1) {
    homeRows.push(req("Everyone applying lives here", draft.everyoneSameAddress));
  }
  sections.push({ title: "Home address", step: 1, rows: homeRows });

  // ── Mailing address ────────────────────────────────────────────────────
  sections.push({
    title: "Mailing address",
    step: 1,
    rows: draft.mailingSameAsHome
      ? [{ label: "Mailing address", value: "Same as the home address" }]
      : [
          req("Street", draft.mailingStreet),
          req("City", draft.mailingCity),
          req("State", draft.mailingState),
          req("ZIP", draft.mailingZip),
        ],
  });

  // ── Contact ────────────────────────────────────────────────────────────
  sections.push({
    title: "Contact",
    step: 1,
    rows: [
      req("Email", draft.email),
      req("Mobile", draft.phone),
      opt("Home phone", draft.homePhone),
    ],
  });

  // ── Tax household ──────────────────────────────────────────────────────
  const taxRows: Row[] = [
    req("Household size", String(draft.householdSize ?? effectiveHouseholdSize(draft))),
    req("Will file taxes for the coverage year", draft.willFileTaxes),
    req("Filing jointly", draft.fileJointly),
    req("US citizen", draft.usCitizen),
  ];
  if (draft.usCitizen === "Yes") {
    taxRows.push(
      draft.naturalizedOrDerived === ""
        ? req("Citizenship", "")
        : {
            label: "Citizenship",
            value:
              draft.naturalizedOrDerived === "Yes" ? "Became a citizen later" : "Born in the US",
            warn:
              draft.naturalizedOrDerived === "Yes"
                ? "The exchange will ask for a citizenship document."
                : undefined,
          },
    );
  }
  sections.push({ title: "Tax household", step: 2, rows: taxRows });

  // ── Eligibility ────────────────────────────────────────────────────────
  sections.push({
    title: "Eligibility",
    step: 2,
    rows: [
      req("Currently incarcerated", draft.incarcerated),
      req("American Indian or Alaska Native", draft.americanIndianAkNative),
      req("Wants to check for cost savings", draft.wantsCostSavings),
      req("On Medicare Part A or C within 3 months", draft.medicareEnrolledOrSoon),
      req("Claimed as a tax dependent by someone else", draft.claimedAsDependent),
      req("Cares for a child under 19 not on this form", draft.caresForUnder19),
      req("Denied Medicaid or CHIP in the last 90 days", draft.medicaidChipDenied90d),
    ],
  });

  // ── Income ─────────────────────────────────────────────────────────────
  /* The parts cannot exceed the total. Only that direction is checked: a
   * household may legitimately state a total without itemising every source,
   * so a sum BELOW the total is not an error and warning about it would train
   * agents to ignore the warning that matters. */
  const parts = [draft.employmentIncome, draft.spouseEmploymentIncome, draft.otherIncome]
    .map((n) => n ?? 0)
    .reduce((a, b) => a + b, 0);
  const total = draft.householdIncome ?? 0;
  const overshoot = total > 0 && parts > total;

  sections.push({
    title: "Income",
    step: 3,
    rows: [
      req(
        "Annual household income",
        draft.householdIncome === null ? "" : money(draft.householdIncome),
        overshoot
          ? `The sources below add up to ${money(parts)}, more than the household total.`
          : undefined,
      ),
      opt("Employment income", draft.employmentIncome === null ? "" : money(draft.employmentIncome)),
      opt(
        "Spouse employment",
        draft.spouseEmploymentIncome === null ? "" : money(draft.spouseEmploymentIncome),
      ),
      opt("Other income", draft.otherIncome === null ? "" : money(draft.otherIncome)),
      opt("Employer", draft.employer),
    ],
  });

  // ── Coverage and enrollment ────────────────────────────────────────────
  const covRows: Row[] = [req("Has coverage now", draft.existingCoverage)];
  if (draft.existingCoverage === "Yes") {
    covRows.push(req("Type of coverage", draft.typeOfExistingCoverage));
    covRows.push(opt("Coverage loss date", draft.coverageLossDate));
  }
  covRows.push(req("Enrollment type", draft.enrollmentType));
  if (draft.enrollmentType === "Special Enrollment") {
    covRows.push(req("Qualifying event", draft.enrollmentEvent));
    covRows.push(req("Event date", draft.qualifyingEventDate));
  }
  covRows.push(
    req("Offered coverage through a job", draft.employerCoverageOffer),
    req("ICHRA", draft.ichraStatus),
    req("Filed Form 8962", draft.form8962Filed),
  );
  sections.push({ title: "Coverage and enrollment", step: 4, rows: covRows });

  // ── Plan ───────────────────────────────────────────────────────────────
  const plan = draft.selectedPlan;
  if (plan) {
    sections.push({
      title: "Plan",
      step: 5,
      rows: [
        { label: "Plan", value: plan.planName },
        { label: "Carrier", value: plan.carrier },
        { label: "Metal level", value: plan.metalLevel || "—" },
        { label: "Effective", value: monthYear(draft.requestedEffective) },
        { label: "Premium", value: money(plan.premium) },
        { label: "Tax credit", value: plan.aptc ? `−${money(plan.aptc)}` : "$0" },
        { label: "Net to client", value: money(plan.netPremium) },
        { label: "Deductible", value: plan.deductible === null ? "—" : money(plan.deductible) },
        { label: "Max out of pocket", value: plan.moop === null ? "—" : money(plan.moop) },
      ],
    });
  }

  // ── Photo ID ───────────────────────────────────────────────────────────
  sections.push({
    title: "Photo ID",
    step: 5,
    rows: [
      draft.photoId
        ? { label: "License photo", value: draft.photoId.filename }
        : { label: "License photo", value: "None taken", warn: "Usually captured as proof of contact." },
    ],
  });

  return sections;
}

/** Date of birth with the derived age, because a mistyped year is invisible as
 *  a date and obvious as an age — the same reason PersonEditor shows it. */
function dobWithAge(person: Person, draft: CaptureDraft): string {
  const age = ageAt(person.dateOfBirth, draft.requestedEffective);
  return age === null ? person.dateOfBirth : `${person.dateOfBirth} · age ${age}`;
}

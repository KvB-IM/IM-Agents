/**
 * Zoho picklist values, pinned.
 *
 * ── Why this file exists ──────────────────────────────────────────────────
 * Zoho SILENTLY DROPS a picklist value that is not on the field's option list.
 * No error, no warning, a 2xx response — the field simply arrives empty. Three
 * bugs of exactly that shape had already shipped before this file existed:
 *
 *   * `Jot_Dependents.Coverage` was sent "Covered"/"Not Covered"; the picklist
 *     is Yes/No, so every dependent's coverage flag was blank.
 *   * `Jot_Dependents.Relation` was sent "Other"; the option is
 *     "Other Dependent".
 *   * `Type_of_Existing_Coverage` was offered Employer/Marketplace/COBRA/Other
 *     in the UI; none of those are options.
 *
 * So every value this app writes to a Zoho picklist is declared here, verbatim
 * from field metadata, and the UI is built FROM these declarations rather than
 * from a separately-typed list that can drift.
 *
 * ── Keeping it honest ─────────────────────────────────────────────────────
 * Re-read the metadata when a value looks wrong:
 *
 *   ZohoCRM_getFields module=JOTS  → pick_list_values per field
 *
 * The `ZohoCRM.settings.fields.READ` scope is already granted, so this could
 * eventually be fetched at runtime instead of pinned. Pinned for now because a
 * picklist that changes shape mid-shift is worse than one that is stale.
 */

/** A choice as the agent sees it, and as Zoho must receive it. */
export interface Choice {
  /** Sent to Zoho. Must match the picklist option exactly. */
  value: string;
  /** Shown to the agent. Free to be clearer than Zoho's wording. */
  label: string;
}

/**
 * Plain Yes/No, exported for questions that have no Zoho picklist yet and are
 * carried in Agent_Notes (see lib/unhoused.ts). Same shape, so swapping them to
 * real fields later is a one-line change per question.
 */
export const YES_NO: Choice[] = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
];

/** Internal alias, so the Zoho-backed fields read as what they are. */
const yesNo = YES_NO;

/* ── Per-applicant eligibility ──────────────────────────────────────────────
 * All single-valued on the Jot: the dependents subform has only Address, SSN,
 * First, Last, DoB, Gender, Relation and Coverage, so there is nowhere to put a
 * per-dependent answer. These describe the primary applicant and household. */

export const US_CITIZEN = yesNo;
export const TOBACCO = yesNo;
export const FULLTIME_STUDENT = yesNo;
export const NATURALIZED_OR_DERIVED = yesNo;
export const INCARCERATED = yesNo;
export const AMERICAN_INDIAN_AK_NATIVE = yesNo;

export const PREGNANT: Choice[] = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
  { value: "N/A", label: "Not applicable" },
];

export const MEDICAID_CHIP_DENIED_90D: Choice[] = [
  { value: "Yes", label: "Yes — denied in the last 90 days" },
  { value: "No", label: "No" },
  { value: "Unknown", label: "Not sure" },
];

export const EMPLOYER_COVERAGE_OFFER: Choice[] = [
  { value: "Yes", label: "Yes — offered through a job" },
  { value: "No", label: "No" },
  { value: "Unknown", label: "Not sure" },
];

/** `Unemployment` on JOTS — verified Yes/No. */
export const UNEMPLOYMENT = yesNo;

/**
 * Primary caretaker of a child under 19.
 *
 * No Zoho field, so this is not pinned to a picklist — it is carried in
 * Agent_Notes. Declared here anyway so the UI is built from one place, and so
 * swapping it to a real field later is a one-line change.
 */
export const PARENT_CARETAKER = YES_NO;

/**
 * Preferred language.
 *
 * Two options because HealthSherpa's session accepts exactly two locales,
 * `en-US` and `es-MX`, and `es-MX` is what puts the client into the Spanish
 * flow. Zoho's `Preferred_Language` is free TEXT, so there is no picklist to
 * violate — these values are what we choose to store, and the English label is
 * stored rather than a locale code so the office reads a language, not a
 * standard.
 */
export const PREFERRED_LANGUAGE: Choice[] = [
  { value: "English", label: "English" },
  { value: "Spanish", label: "Spanish (Spanish HealthSherpa flow)" },
];

export const ICHRA_STATUS: Choice[] = [
  { value: "No ICHRA", label: "No ICHRA" },
  { value: "Offered - Not Accepted", label: "Offered, not accepted" },
  { value: "Enrolled in ICHRA", label: "Enrolled in an ICHRA" },
  { value: "Unknown", label: "Not sure" },
];

export const FORM_8962_FILED: Choice[] = [
  { value: "Yes", label: "Yes" },
  { value: "No", label: "No" },
  { value: "Not Applicable", label: "Did not get the credit" },
  { value: "Unknown", label: "Not sure" },
];

/* ── Tax household ───────────────────────────────────────────────────────── */

export const WILL_FILE_TAXES = yesNo;
export const FILE_JOINTLY = yesNo;
export const FILED_TAXES = yesNo;

export const HOUSEHOLD_TYPE: Choice[] = [
  { value: "Single with No Dependents", label: "Single, no dependents" },
  { value: "Single with Dependents", label: "Single with dependents" },
  { value: "Married with No Dependents", label: "Married, no dependents" },
  { value: "Married with Dependents", label: "Married with dependents" },
];

/* ── Existing coverage ───────────────────────────────────────────────────── */

export const EXISTING_INSURANCE_COVERAGE = yesNo;

/**
 * Type of existing coverage.
 *
 * FOUR options, and none of them is "Employer", "Marketplace" or "COBRA" —
 * which is what the capture form used to offer. Employer and Marketplace plans
 * both land under "Other Carrier"; the picklist distinguishes government
 * programmes from everything else, not employer from individual.
 */
export const TYPE_OF_EXISTING_COVERAGE: Choice[] = [
  { value: "Medicare", label: "Medicare" },
  { value: "Medicaid", label: "Medicaid" },
  { value: "Veterans Coverage / Tricare", label: "VA or Tricare" },
  { value: "Other Carrier", label: "Other carrier (employer, marketplace, COBRA…)" },
];

/* ── Enrollment period ───────────────────────────────────────────────────── */

export const ENROLLMENT_TYPE: Choice[] = [
  { value: "Open Enrollment", label: "Open Enrollment" },
  { value: "Special Enrollment", label: "Special Enrollment (SEP)" },
];

export const REENROLLING = yesNo;

/* ── Which enrollment path filed this ───────────────────────────────────────
 * `Form_Type` already drew this distinction before this app existed: a form the
 * office still has to enroll, and one the agent enrolled in the field. That is
 * exactly the fork the review screen now offers, so no new option was added and
 * the office's existing reports keep working.
 *
 * ⚠️ Verified against live JOTS field metadata. Both values are VERBATIM,
 * including "Feild" — that is Zoho's own spelling. Correcting it here would put
 * the value off-list, and Zoho would silently drop it.
 *
 * This app had been sending `Form_Type: "Agent Portal"` and
 * `Method: "Field Agent"`. NEITHER is an option on its picklist, so both were
 * silently discarded and every agent-portal Jot filed before this change
 * carried two blank fields — the fourth instance of the bug class at the top of
 * this file, in the one pair of picklists this file did not yet declare.
 *
 * `Method` is no longer written at all. Its real options are PR-Only /
 * PR-Usurp / CR&PR: representation and AOR mechanics, nothing to do with where
 * a form came from. Agent-portal origin is already legible from the `AP-`
 * prefix on `Name`.
 *
 * Seven other `Form_Type` options exist on the field (six `Short Form - …`
 * variants plus `-None-`). They are deliberately NOT declared: this list is an
 * outbound allowlist, and the capture screen only ever files a full form. */

/** The office enrolls it. The historical agent-portal path. */
export const FORM_TYPE_OFFICE = "Full Form - Needs Enrollment";
/** The agent enrolled the client on HealthSherpa at the table. */
export const FORM_TYPE_HEALTHSHERPA = "Full Form - Enrolled In Feild";

export const FORM_TYPE: Choice[] = [
  { value: FORM_TYPE_OFFICE, label: "Office enrolls it" },
  { value: FORM_TYPE_HEALTHSHERPA, label: "Enrolled in the field" },
];

/* ── Dependents subform ─────────────────────────────────────────────────────
 * Verified against the Jot_Dependents subform's own field metadata. */

/** `Jot_Dependents.Relation`. Note "Other Dependent", not "Other". */
export const DEPENDENT_RELATION: Choice[] = [
  { value: "Spouse", label: "Spouse" },
  { value: "Child", label: "Child" },
  { value: "Other Dependent", label: "Other dependent" },
];

/** `Jot_Dependents.Coverage` — Yes/No. NOT "Covered"/"Not Covered". */
export const DEPENDENT_COVERAGE = yesNo;

/** `Jot_Dependents.Gender` and the parent `Gender` — both Male/Female. */
export const GENDER: Choice[] = [
  { value: "Female", label: "Female" },
  { value: "Male", label: "Male" },
];

/**
 * Guard a value before it goes to Zoho.
 *
 * Returns "" for anything not on the list, so the write allowlist drops it
 * rather than Zoho silently swallowing it. An empty field is at least visibly
 * empty; a dropped value looks like the agent never answered.
 */
export function pinned(choices: Choice[], value: string | null | undefined): string {
  if (!value) return "";
  return choices.some((c) => c.value === value) ? value : "";
}

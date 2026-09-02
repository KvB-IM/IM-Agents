/** Shared shapes. The capture record is the source; the quote request and the
 *  Jot are both projections of it (SOFTWARE_SCOPE.md section 5). */

export type Relation = "primary" | "spouse" | "child" | "other";

export interface Person {
  /** Stable within a draft, so React keys and dependent rows stay put. */
  key: string;
  relation: Relation;
  firstName: string;
  lastName: string;
  /** YYYY-MM-DD. Captured instead of age — the Jot needs DoB, the quote needs
   *  age, and asking twice is how the two drift apart. */
  dateOfBirth: string;
  sex: "" | "Male" | "Female";
  tobacco: boolean;
  /** Raw digits, no dashes — the dashed form is presentation and is applied on
   *  submit. Write-only from the field: submitted, never read back. */
  ssn: string;
  /** Second entry, compared on the digits. Never leaves the browser: it exists
   *  to catch a typo, and sending it would just be a second copy of an SSN. */
  ssnConfirm: string;
  seekingCoverage: boolean;
}

export interface County {
  fipsCode: string;
  name: string;
  state: string;
}

export interface CaptureDraft {
  id: string;
  updatedAt: string;

  // Location
  zip: string;
  county: County | null;
  street: string;
  city: string;

  // Household
  people: Person[];
  householdSize: number | null;
  householdIncome: number | null;
  employmentIncome: number | null;
  spouseEmploymentIncome: number | null;
  otherIncome: number | null;
  employer: string;

  // Contact (primary only)
  email: string;
  phone: string;
  homePhone: string;

  // Eligibility
  usCitizen: string;
  willFileTaxes: string;
  fileJointly: string;

  // Existing coverage / SEP
  existingCoverage: string;
  typeOfExistingCoverage: string;
  coverageLossDate: string;
  enrollmentType: string;
  enrollmentEvent: string;
  qualifyingEventDate: string;

  // Plan
  requestedEffective: string;
  selectedPlan: SelectedPlan | null;
}

export interface SelectedPlan {
  planId: string;
  planName: string;
  carrier: string;
  metalLevel: string;
  planHiosId: string;
  carrierHiosId: string;
  /** Gross monthly premium. */
  premium: number;
  /** Advance premium tax credit applied. */
  aptc: number;
  /** What the client actually pays: premium - aptc. */
  netPremium: number;
  deductible: number | null;
  moop: number | null;
}

export interface QuotedPlan extends SelectedPlan {
  planType: string;
  hsaEligible: boolean;
}

/** An enrollment form as this app reads it back. Mirrors the normalized shape
 *  in IM_CRM_Frontend/server/lines/aca.js so the two apps agree. */
export interface Jot {
  id: string;
  formId: string;
  clientName: string;
  status: string;
  /** Enrollment_Stage. The field every KPI is built on. Empty is meaningful:
   *  it means the office has not staged the form yet. */
  enrollmentStage: string;
  /** Classification — the office's validity call: Valid, Invalid, Bad Jot,
   *  Pending Validation, Undetermined. */
  classification: string;
  requirementStage: string;
  requirementDue: string;
  problems: string[];
  requiredDocuments: string[];
  submittedAt: string;
  requestedEffective: string;
  premium: number | null;
  netPremium: number | null;
  carrier: string;
  plan: string;
  metalLevel: string;
  householdSize: number | null;
  policyId: string;
  policyName: string;
  submittingFieldAgent: string;
}

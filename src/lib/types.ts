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
  /**
   * Pregnant. Per-person, because the application asks it of every female
   * applicant seeking coverage — not just the primary.
   *
   * ⚠️ The Jot's `Pregnant` field is single-valued and Jot_Dependents has no
   * column for it, so only the primary's answer has a home. Anyone else's is
   * written into Agent_Notes so it is not lost. See draftToJot.
   */
  pregnant: string;
  /** Raw digits, no dashes — the dashed form is presentation and is applied on
   *  submit. Write-only from the field: submitted, never read back. */
  ssn: string;
  /** Second entry, compared on the digits. Never leaves the browser: it exists
   *  to catch a typo, and sending it would just be a second copy of an SSN. */
  ssnConfirm: string;
  /**
   * "This person has never been issued an SSN."
   *
   * A real path on HealthSherpa's application and a real field on the Jot
   * (`No_SSN_Attestation`, boolean). Making SSN unconditionally required would
   * have blocked a lawful enrollment — an applicant who has genuinely never
   * been issued one cannot produce a number, and the exchange accepts the
   * attestation instead.
   *
   * It is an attestation, not a convenience: HealthSherpa's own wording is
   * "You may only check this box if this person attests that they have never
   * been issued an SSN by the Social Security Administration."
   */
  noSsn: boolean;
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

  /** "Is the mailing address the same as the home address?" */
  mailingSameAsHome: boolean;
  mailingStreet: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;

  /**
   * Questions the application asks that have NO dedicated Jot field yet.
   * Written into Agent_Notes as a delimited block so the office sees them and
   * nothing is lost; each becomes a real field once Zoho has one.
   */
  wantsCostSavings: string;
  medicareEnrolledOrSoon: string;
  claimedAsDependent: string;
  caresForUnder19: string;
  everyoneSameAddress: string;

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

  // Eligibility. All single-valued because the Jot_Dependents subform has no
  // columns for them — it holds only Address, SSN, First, Last, DoB, Gender,
  // Relation and Coverage. These describe the primary applicant and household.
  usCitizen: string;
  naturalizedOrDerived: string;
  incarcerated: string;
  americanIndianAkNative: string;
  medicaidChipDenied90d: string;
  employerCoverageOffer: string;
  ichraStatus: string;
  form8962Filed: string;
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

  /**
   * The applicant's photo ID, already uploaded to staging.
   *
   * Uploaded when taken rather than at submit, so a connectivity failure
   * surfaces while the agent is still with the client. Attached to the Jot
   * after the record exists — an attachment needs a record id.
   */
  photoId: { url: string; filename: string; bytes: number } | null;
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

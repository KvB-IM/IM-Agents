import "server-only";
import { createHash } from "node:crypto";
import { formatSsn } from "./ssn";
import type { CaptureDraft, Person } from "./types";
import { ageAt } from "./age";

/**
 * Capture draft → Zoho JOTS record.
 *
 * Module facts confirmed against IM_CRM_Frontend/server/lines/aca.js:
 *   module            JOTS
 *   client link       Client (lookup to Contacts)
 *   dependents        Jot_Dependents subform
 *   form identifier   Name  (labelled "Form ID" in Zoho)
 *
 * The mapping table this implements is SOFTWARE_SCOPE.md section 5.
 */

export const JOT_MODULE = "JOTS";

/**
 * The Jot's own identifier — Zoho's `Name` field, labelled "Form ID".
 *
 * `Name` is system_mandatory and unique on this module, and it is NOT
 * auto-numbered: today's values are JotForm submission ids (`ID5117…`,
 * `ZFID69369`), set by whatever created the record. So this app has to mint its
 * own, and a create without one is rejected.
 *
 * Two things follow from the uniqueness constraint, and the second is the more
 * valuable:
 *
 * 1. An `AP-` prefix makes an agent-portal submission identifiable at a glance
 *    in the office's queue, alongside Form_Type and Method.
 * 2. **Zoho becomes the idempotency check.** The id is derived deterministically
 *    from the agent and their submission key, so a replayed submit produces the
 *    same `Name` and Zoho refuses it as DUPLICATE_DATA — which the caller turns
 *    back into "already filed". That is durable across processes and deploys,
 *    unlike an in-memory map, which only ever covered a double-tap on one
 *    instance.
 *
 * Hashed rather than using the raw key so a client cannot choose another
 * agent's form id, and so the value stays short and layout-safe.
 */
/**
 * Format a datetime the way Zoho's API will actually accept it.
 *
 * ISO-8601 with an explicit numeric offset. `Date.toISOString()` is NOT
 * accepted — it renders UTC as a trailing `Z` with milliseconds, and Zoho
 * rejects that with INVALID_DATA / expected_data_type "datetime". Verified
 * against the live module both ways: `2026-09-02T17:56:16.000Z` was refused and
 * `2026-09-02T13:56:16-04:00` was accepted.
 *
 * Written in UTC with a literal `+00:00` offset rather than the host's local
 * offset, so the value does not depend on the timezone of whatever machine or
 * serverless region happens to run it.
 */
export function zohoDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19)}+00:00`;
}

export function formIdFor(agentId: string, submissionKey: string): string {
  const digest = createHash("sha256")
    .update(`${agentId}\u0000${submissionKey}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
  return `AP-${digest}`;
}

/**
 * The capture write allowlist.
 *
 * This is a safety boundary, not payload hygiene: a field absent from here can
 * never be written, whatever the browser sends. It is deliberately SEPARATE
 * from the back office's `enrollments.writable` allowlist in IM_CRM_Frontend —
 * that one is an enroller's *correction* set of ~25 fields, and widening it to
 * cover a whole application would hand the field app write access to the
 * enroller's own pipeline record.
 *
 * Note `Naturized_or_Derived`: the misspelling is Zoho's actual API name.
 */
export const CAPTURE_WRITABLE = {
  // Record identity. Mandatory on this module and minted by formIdFor.
  Name: "text",
  // When the agent filed it. NOT auto-populated on an API create — verified
  // against production: a created record came back with Submission_Time null.
  // It has to be set here, and it matters more than it looks:
  //   * it is what the pipeline query sorts by, and
  //   * any office report filtering on Submission_Time would silently omit
  //     every agent-portal form if it were left empty.
  Submission_Time: "datetime",
  // HS step 2 — primary applicant identity
  First_Name: "text",
  Last_Name: "text",
  DoB: "date",
  Gender: "picklist",
  SSN: "ssn",
  // HS step 3 — address and contact
  Home_Street: "text",
  Home_City: "text",
  Home_State: "text",
  Home_Zip: "text",
  Home_County: "text",
  Mailing_County: "text",
  No_SSN_Attestation: "boolean",
  Name_Suffix: "text",
  Email: "email",
  Phone: "phone",
  Home_Phone: "phone",
  // HS steps 4-5 — household and tax household
  Household_Size: "integer",
  Will_File_Taxes: "picklist",
  File_Jointly: "picklist",
  // HS step 6 — per-person eligibility
  Tobacco: "picklist",
  US_Citizen: "picklist",
  Naturized_or_Derived: "picklist",
  Fulltime_Student: "picklist",
  // HS step 7 — income
  Household_Income: "number",
  Employment_Income: "number",
  Spouse_Employment_Income: "number",
  Other_Income: "number",
  Employer: "text",
  // HS step 8 — existing coverage and the SEP event
  Existing_Insurance_Coverage: "picklist",
  Type_of_Existing_Coverage: "picklist",
  Coverage_Loss_Date: "date",
  Enrollment_Type: "picklist",
  Enrollment_Event: "picklist",
  Qualifying_Event_Date: "date",
  // Plan chosen at the end of the application
  Requested_Effective_Date: "date",
  Premium: "number",
  Carrier1: "text",
  Plan1: "text",
  Carrier_HIOS_ID: "text",
  Plan_HIOS_ID: "text",
  Policy_Year: "text",
  // Origin. Lets the back office tell an agent-portal submission from a
  // JotForm one and report on the two separately.
  Form_Type: "picklist",
  Method: "picklist",
} as const;

/**
 * Fields the SERVER owns. Present here so it is obvious they are never taken
 * from a request body — an agent must not be able to file a Jot as another
 * agent, which is a PII boundary and a commission one (scope section 7.5).
 */
export const SERVER_STAMPED = [
  "Submitting_Field_Agent",
  "Submitting_Sub_Agent",
  "Submitting_Regional_Manager",
  "Agency",
] as const;

/*
 * `Agent_NPN` is deliberately NOT stamped here.
 *
 * A field agent is not the NPN of record on these enrollments — the accredited
 * enrolling agent is, and the office owns that field. Writing the field agent's
 * number into it would put the wrong producer on the application, so this app
 * neither writes it nor shows it, and no screen tells an agent a form was filed
 * "under your NPN".
 *
 * Attribution runs through `Submitting_Field_Agent` instead, which Zoho labels
 * "Accredited Field Agent" and which is exactly what it is for.
 */

/** Subform columns, mirroring the parent allowlist. */
export const DEPENDENT_WRITABLE = {
  First: "text",
  Last: "text",
  Relation: "picklist",
  DoB: "date",
  Gender: "picklist",
  Coverage: "picklist",
  SSN: "ssn",
} as const;

const yesNo = (v: boolean) => (v ? "Yes" : "No");

function primaryOf(draft: CaptureDraft): Person | undefined {
  return draft.people.find((p) => p.relation === "primary") ?? draft.people[0];
}

export interface AgentIdentity {
  id: string;
  /**
   * Must match this agent's entry in Zoho's `Agent` global picklist exactly.
   * `Submitting_Field_Agent` is a picklist backed by that global set, not a
   * user lookup and not free text, so an agent who is not on the picklist
   * cannot be written to a Jot at all — onboarding one is a Zoho change as
   * well as an account here.
   */
  name: string;
  agency: string;
  subAgent?: string;
  regionalManager?: string;
}

/**
 * Build the Zoho create payload. Every key is checked against the allowlist on
 * the way out, so a field added to this function but not to CAPTURE_WRITABLE is
 * dropped rather than silently written.
 */
export function draftToJot(
  draft: CaptureDraft,
  agent: AgentIdentity,
  submissionKey: string,
): Record<string, unknown> {
  const primary = primaryOf(draft);
  const plan = draft.selectedPlan;
  const effective = draft.requestedEffective;

  const raw: Record<string, unknown> = {
    // Mandatory and unique. See formIdFor.
    Name: formIdFor(agent.id, submissionKey),
    Submission_Time: zohoDateTime(new Date()),
    First_Name: primary?.firstName ?? "",
    Last_Name: primary?.lastName ?? "",
    DoB: primary?.dateOfBirth ?? "",
    Gender: primary?.sex ?? "",
    // Dashed on the way out: existing JOTS records are stored XXX-XX-XXXX, and
    // the draft holds raw digits. formatSsn returns "" on anything incomplete,
    // which the allowlist gate then drops rather than writing a partial number.
    SSN: formatSsn(primary?.ssn ?? ""),
    // Boolean on the Jot. Only sent when true — the allowlist gate drops
    // false, and an absent value reads the same as "not attested".
    ...(primary?.noSsn ? { No_SSN_Attestation: true } : {}),

    Home_Street: draft.street,
    Home_City: draft.city,
    Home_State: draft.county?.state ?? "",
    Home_Zip: draft.zip,
    /* The county belongs to the HOME address, which is the one this form
     * collects. It was being written to Mailing_County only — so a Jot filed
     * from the field had no home county, while the office's own transcription
     * fills Home_County. Both are written now; they are the same address
     * unless a separate mailing address is captured, which this form does not
     * yet do. */
    Home_County: draft.county?.name ?? "",
    Mailing_County: draft.county?.name ?? "",
    Email: draft.email,
    Phone: draft.phone,
    Home_Phone: draft.homePhone,

    Household_Size: draft.householdSize,
    Will_File_Taxes: draft.willFileTaxes,
    File_Jointly: draft.fileJointly,

    Tobacco: primary ? yesNo(primary.tobacco) : "",
    US_Citizen: draft.usCitizen,

    Household_Income: draft.householdIncome,
    Employment_Income: draft.employmentIncome,
    Spouse_Employment_Income: draft.spouseEmploymentIncome,
    Other_Income: draft.otherIncome,
    Employer: draft.employer,

    Existing_Insurance_Coverage: draft.existingCoverage,
    Type_of_Existing_Coverage: draft.typeOfExistingCoverage,
    Coverage_Loss_Date: draft.coverageLossDate,
    Enrollment_Type: draft.enrollmentType,
    Enrollment_Event: draft.enrollmentEvent,
    Qualifying_Event_Date: draft.qualifyingEventDate,

    Requested_Effective_Date: effective,
    // Premium on the Jot is the gross premium; the office reconciles APTC
    // against the carrier. Net is shown to the agent but not written.
    Premium: plan?.premium ?? null,
    Carrier1: plan?.carrier ?? "",
    Plan1: plan?.planName ?? "",
    Carrier_HIOS_ID: plan?.carrierHiosId ?? "",
    Plan_HIOS_ID: plan?.planHiosId ?? "",
    Policy_Year: effective ? effective.slice(0, 4) : "",

    Form_Type: "Agent Portal",
    Method: "Field Agent",
  };

  // Allowlist gate.
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in CAPTURE_WRITABLE)) continue;
    if (value === null || value === undefined || value === "") continue;
    payload[key] = value;
  }

  // Server-stamped attribution. Assigned AFTER the allowlist gate precisely so
  // it cannot be spoofed through it.
  payload.Submitting_Field_Agent = agent.name;
  payload.Agency = agent.agency;
  if (agent.subAgent) payload.Submitting_Sub_Agent = agent.subAgent;
  if (agent.regionalManager) payload.Submitting_Regional_Manager = agent.regionalManager;

  // Dependents subform. The primary is the parent record, so it is excluded.
  const dependents = draft.people
    .filter((p) => p !== primary)
    .map((p) => {
      const row: Record<string, unknown> = {
        First: p.firstName,
        Last: p.lastName,
        Relation: p.relation === "spouse" ? "Spouse" : p.relation === "child" ? "Child" : "Other",
        DoB: p.dateOfBirth,
        Gender: p.sex,
        Coverage: p.seekingCoverage ? "Covered" : "Not Covered",
        SSN: formatSsn(p.ssn),
      };
      return Object.fromEntries(
        Object.entries(row).filter(([k, v]) => k in DEPENDENT_WRITABLE && v !== "" && v !== null),
      );
    });

  if (dependents.length) payload.Jot_Dependents = dependents;

  return payload;
}

/**
 * What the quote endpoint needs, derived from the same draft. Ages come from
 * DoB at the effective date; relationships are positional, matching the
 * working route in IM-Website.
 */
export function draftToQuoteRequest(draft: CaptureDraft) {
  const effective = draft.requestedEffective;
  const covered = draft.people.filter((p) => p.seekingCoverage);

  return {
    zip_code: draft.zip,
    fips_code: draft.county?.fipsCode ?? "",
    state: draft.county?.state ?? "",
    household_size: draft.householdSize ?? covered.length,
    annual_income: draft.householdIncome,
    effective_date: effective,
    applicants: covered.map((p) => ({
      age: ageAt(p.dateOfBirth, effective),
      uses_tobacco: p.tobacco,
    })),
  };
}

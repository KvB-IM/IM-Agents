import "server-only";
import type { County, Jot, QuotedPlan } from "./types";

/**
 * Fixture data, shaped identically to normalized upstream output.
 *
 * The convention is borrowed from both existing apps: IM_CRM_Frontend serves
 * fixtures when Zoho OAuth is unconfigured, IM-Website has HS_ENROLLMENT_MOCK.
 * It is what lets the UI be built and demoed before a key exists — and on an
 * iPad at a kitchen table with no signal, it is also how you show the thing.
 *
 * A "Fixture data" badge is shown in the header whenever this is active.
 */

export const FIXTURE_COUNTIES: Record<string, County[]> = {
  // A ZIP that spans two counties, which is the case the UI has to handle.
  "85201": [
    { fipsCode: "04013", name: "Maricopa", state: "AZ" },
    { fipsCode: "04021", name: "Pinal", state: "AZ" },
  ],
  "85281": [{ fipsCode: "04013", name: "Maricopa", state: "AZ" }],
  "33145": [{ fipsCode: "12086", name: "Miami-Dade", state: "FL" }],
  "75201": [{ fipsCode: "48113", name: "Dallas", state: "TX" }],
};

/** Any other ZIP resolves to a single generic county so the flow never dead-ends. */
export function fixtureCounties(zip: string): County[] {
  return FIXTURE_COUNTIES[zip] ?? [{ fipsCode: "04013", name: "Maricopa", state: "AZ" }];
}

/**
 * Fixture plans. Premiums scale with the household so the quote responds to the
 * capture data rather than looking static, and APTC is a rough function of
 * income against the second-lowest silver — enough to demo the maths, nowhere
 * near enough to quote a client.
 */
export function fixturePlans(householdSize: number, income: number | null, totalAge: number): QuotedPlan[] {
  const base = 320 + totalAge * 6 + (householdSize - 1) * 180;

  const shapes: Array<Omit<QuotedPlan, "premium" | "aptc" | "netPremium">> = [
    {
      planId: "hs-plan-bronze-1", planName: "Ambetter Essential Care 1 HSA", carrier: "Ambetter",
      metalLevel: "Bronze", planHiosId: "12345AZ0010001", carrierHiosId: "12345",
      deductible: 7500, moop: 9450, planType: "HMO", hsaEligible: true,
    },
    {
      planId: "hs-plan-bronze-2", planName: "Blue Cross Bronze B07S", carrier: "Blue Cross Blue Shield",
      metalLevel: "Bronze", planHiosId: "54321AZ0020003", carrierHiosId: "54321",
      deductible: 6900, moop: 9200, planType: "PPO", hsaEligible: false,
    },
    {
      planId: "hs-plan-silver-1", planName: "Ambetter Balanced Care 4", carrier: "Ambetter",
      metalLevel: "Silver", planHiosId: "12345AZ0010007", carrierHiosId: "12345",
      deductible: 4500, moop: 8700, planType: "HMO", hsaEligible: false,
    },
    {
      planId: "hs-plan-silver-2", planName: "Oscar Silver Simple", carrier: "Oscar Health",
      metalLevel: "Silver", planHiosId: "77777AZ0030002", carrierHiosId: "77777",
      deductible: 4000, moop: 8200, planType: "EPO", hsaEligible: false,
    },
    {
      planId: "hs-plan-gold-1", planName: "Blue Cross Gold B02S", carrier: "Blue Cross Blue Shield",
      metalLevel: "Gold", planHiosId: "54321AZ0020009", carrierHiosId: "54321",
      deductible: 1500, moop: 6800, planType: "PPO", hsaEligible: false,
    },
    {
      planId: "hs-plan-gold-2", planName: "Oscar Gold Classic", carrier: "Oscar Health",
      metalLevel: "Gold", planHiosId: "77777AZ0030008", carrierHiosId: "77777",
      deductible: 1200, moop: 6500, planType: "EPO", hsaEligible: false,
    },
  ];

  const multipliers = [0.82, 0.88, 1.0, 1.06, 1.34, 1.42];

  // Second-lowest silver is the benchmark plan APTC is computed against.
  const benchmark = base * 1.0;
  // Rough contribution curve: the lower the income, the more of the benchmark
  // is covered. Real subsidy maths is FPL-table driven — this is a stand-in.
  const expectedContribution =
    income === null ? benchmark : Math.max(0, Math.min(benchmark, (income / 12) * 0.085));
  const aptc = Math.max(0, Math.round(benchmark - expectedContribution));

  return shapes.map((shape, i) => {
    const premium = Math.round(base * multipliers[i]);
    return {
      ...shape,
      premium,
      aptc: Math.min(aptc, premium),
      netPremium: Math.max(0, premium - Math.min(aptc, premium)),
    };
  }).sort((a, b) => a.netPremium - b.netPremium);
}

/**
 * Jots already in flight, as the office would have left them.
 *
 * Stages are the real Zoho values. One record is deliberately left unstaged
 * and one carries a stage this app has not been taught about, because both
 * happen in the live data and both have to render rather than vanish.
 */
/**
 * The agent the fixtures belong to.
 *
 * Follows PROTOTYPE_AGENT_NAME so fixture mode shows data whatever that is set
 * to. Hard-coding a name here meant changing the configured agent silently
 * emptied the pipeline, which looks exactly like the real failure it is not
 * (an agent missing from Zoho's `Agent` picklist).
 */
const FIXTURE_AGENT = process.env.PROTOTYPE_AGENT_NAME || "Dana Ruiz";

/** A different agent, for the one record that proves the scope filter works. */
const OTHER_AGENT = FIXTURE_AGENT === "Cassidy Marsh" ? "Rowan Pike" : "Cassidy Marsh";

export const FIXTURE_JOTS: Jot[] = [
  {
    id: "9000000000000501001", formId: "ID99000000000000001", clientName: "Marisol Vega",
    status: "Awaiting Validation", enrollmentStage: "Ready to Enroll",
    classification: "Pending Validation",
    requirementStage: "Documents requested", requirementDue: "2026-09-12",
    problems: ["Income mismatch", "SSN illegible"],
    requiredDocuments: ["Proof of income", "Photo ID"],
    submittedAt: "2026-08-27T15:40:00Z", requestedEffective: "2026-10-01",
    premium: 612, netPremium: 118, carrier: "Ambetter", plan: "Balanced Care 4",
    metalLevel: "Silver", householdSize: 3, policyId: "", policyName: "",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    id: "9000000000000501002", formId: "ID99000000000000002", clientName: "Terrence Boyd",
    status: "Awaiting Validation", enrollmentStage: "Enrolling",
    classification: "Valid",
    requirementStage: "", requirementDue: "",
    problems: [], requiredDocuments: [],
    submittedAt: "2026-08-30T18:05:00Z", requestedEffective: "2026-10-01",
    premium: 438, netPremium: 0, carrier: "Blue Cross Blue Shield", plan: "Bronze B07S",
    metalLevel: "Bronze", householdSize: 1, policyId: "", policyName: "",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    id: "9000000000000501003", formId: "ID99000000000000003", clientName: "Aiyana Fontaine",
    status: "Converted - Client & Policy", enrollmentStage: "Enrolled",
    classification: "Valid",
    requirementStage: "", requirementDue: "",
    problems: [], requiredDocuments: [],
    submittedAt: "2026-08-14T13:22:00Z", requestedEffective: "2026-09-01",
    premium: 903, netPremium: 241, carrier: "Oscar Health", plan: "Gold Classic",
    metalLevel: "Gold", householdSize: 4,
    policyId: "9000000000000601001", policyName: "Fontaine — Oscar Gold 2026",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    id: "9000000000000501004", formId: "ID99000000000000004", clientName: "Devon Ashcroft",
    status: "Awaiting Validation", enrollmentStage: "Failed to Enroll",
    classification: "Bad Jot",
    requirementStage: "", requirementDue: "",
    problems: ["Duplicate application"], requiredDocuments: [],
    submittedAt: "2026-07-22T16:10:00Z", requestedEffective: "2026-09-01",
    premium: 377, netPremium: 12, carrier: "Ambetter", plan: "Essential Care 1 HSA",
    metalLevel: "Bronze", householdSize: 1, policyId: "", policyName: "",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    id: "9000000000000501005", formId: "ID99000000000000005", clientName: "Priya Raghunathan",
    status: "Converted - Client & Policy", enrollmentStage: "Enrolled",
    classification: "Valid",
    requirementStage: "", requirementDue: "",
    problems: [], requiredDocuments: [],
    submittedAt: "2026-07-09T14:55:00Z", requestedEffective: "2026-08-01",
    premium: 1104, netPremium: 402, carrier: "Blue Cross Blue Shield", plan: "Gold B02S",
    metalLevel: "Gold", householdSize: 5,
    policyId: "9000000000000601002", policyName: "Raghunathan — BCBS Gold 2026",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    // Unstaged. The office has not picked it up, which is the commonest state
    // for anything recent and the reason UNSTAGED is a real bucket.
    id: "9000000000000501006", formId: "ID99000000000000006", clientName: "Hollis Nakamura",
    status: "Awaiting Validation", enrollmentStage: "",
    classification: "Undetermined",
    requirementStage: "", requirementDue: "",
    problems: [], requiredDocuments: [],
    submittedAt: "2026-09-01T19:30:00Z", requestedEffective: "2026-11-01",
    premium: 524, netPremium: 96, carrier: "Oscar Health", plan: "Silver Simple",
    metalLevel: "Silver", householdSize: 2, policyId: "", policyName: "",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    // A stage value this app has not been taught. Must render verbatim rather
    // than disappear from the pipeline or the funnel.
    id: "9000000000000501007", formId: "ID99000000000000007", clientName: "Rosalind Ferrer",
    status: "Awaiting Validation", enrollmentStage: "Awaiting Carrier",
    classification: "Valid",
    requirementStage: "", requirementDue: "",
    problems: [], requiredDocuments: [],
    submittedAt: "2026-08-06T11:15:00Z", requestedEffective: "2026-10-01",
    premium: 690, netPremium: 155, carrier: "Ambetter", plan: "Balanced Care 4",
    metalLevel: "Silver", householdSize: 2, policyId: "", policyName: "",
    submittingFieldAgent: FIXTURE_AGENT,
  },
  {
    // Belongs to someone else. Present ON PURPOSE: it is what proves the scope
    // filter is doing something. It must never appear in the agent's pipeline.
    id: "9000000000000501099", formId: "ID99000000000000008",
    clientName: "Someone Else's Client",
    status: "Awaiting Validation", enrollmentStage: "Ready to Enroll",
    classification: "Valid",
    requirementStage: "", requirementDue: "",
    problems: [], requiredDocuments: [],
    submittedAt: "2026-08-29T10:00:00Z", requestedEffective: "2026-10-01",
    premium: 500, netPremium: 90, carrier: "Ambetter", plan: "Balanced Care 4",
    metalLevel: "Silver", householdSize: 2, policyId: "", policyName: "",
    submittingFieldAgent: OTHER_AGENT,
  },
];

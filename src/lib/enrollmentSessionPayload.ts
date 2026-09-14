/**
 * Capture draft → HealthSherpa enrollment session payload.
 *
 * The third projection of the capture record, alongside `draftToJot` and
 * `draftToQuoteRequest` (SOFTWARE_SCOPE.md section 5). One source, three shapes.
 *
 * Pure and import-free apart from `household.ts` and types, like reviewRows.ts
 * and ssn.ts — and here that is not a nicety. The account is not authorized for
 * `/v1/enrollment-sessions` yet, so these tests are the ONLY way this payload
 * can be checked at all, and the spec rejects the entire request with
 * `400 invalid_request` for one unsupported key rather than ignoring it. The
 * network call and the feature flags live in enrollmentSession.ts.
 *
 * ── What the endpoint actually is ─────────────────────────────────────────
 * NOT an enrollment API. It "always returns deep links and does not create
 * direct enrollment application records" — it pre-fills a household and hands a
 * BROWSER to HealthSherpa, where a person finishes the application. There is no
 * API that submits an on-exchange ACA application. See
 * docs/healthsherpa-contract.md.
 *
 * ── Verified live, 2026-09-08 ─────────────────────────────────────────────
 * The full payload this file builds — `context` (agent_assisted, en-US/es-MX),
 * `location`, `external_id`, `household` with `annual_income` and
 * `someone_has_employer_coverage`, and applicants carrying names, primary
 * contact, DoB, sex, tobacco, pregnancy, `rejected_by_medicaid_or_chip`,
 * `unemployment`, `parent_caretaker`, `has_existing_coverage` and
 * `income_sources[]` — was accepted with a 200 via the `dryRun=1&forward=1`
 * probe in api/enrollments. The account IS authorized for this endpoint now,
 * and every key here is known-good. A 400 in future means a key was ADDED
 * since; bisect from the newest.
 *
 * What came back, which also settles how the deep link works:
 *
 *   links.client_apply_url   …/public/apply?_agent_id=IM&external_id=<Name>
 *                            &intake_form_id=<n>&state=SC&user_type=agent
 *   links.shopping_url       …/public/shop?…&household_income=…&household_size=…
 *                            &people[primary][age]=…&zip_code=…   (quote-level
 *                            fields in the query string; no names, no DoB)
 *
 * The pre-filled household lives HealthSherpa-side under `intake_form_id`; the
 * apply URL carries a reference to it, not the data. `_agent_id=IM` is the
 * agency, from the API key. `user_type=agent` says who is expected to open it.
 * And `external_id` round-trips, so the Jot's `Name` really is one identifier
 * a rep can search either system with.
 *
 * `self_service` was verified the same day: 200 with `plan_id` accepted and
 * names/contact absent. Its apply link differs — `user_type=consumer`,
 * `plan_hios_id` and `plan_year` in the query string, and NO `intake_form_id`;
 * the household rides in the shopping link's query string instead, and that
 * page renders it pre-filled. The apply link opens at the privacy statement
 * with no login. Whether the application screens beyond the consent are
 * pre-filled from `external_id` was not checked — signing the consents is the
 * client's act, not a probe's.
 */

import { effectiveHouseholdSize } from "./household.ts";
import type { CaptureDraft, Person } from "./types.ts";

/**
 * Which HealthSherpa flow the deep link opens into.
 *
 * `agent_assisted` — an agent opens the link, signs in as themselves, and their
 *   own NPN goes on the application. Accepts names and primary contact details.
 *   Rejects `plan_id`. Verified live 2026-09-08 (login wall confirmed).
 * `self_service` — the CLIENT opens the link. Verified live 2026-09-08: it
 *   opens straight into HealthSherpa's privacy statement with NO login, and the
 *   consent text names the agency's agent (the account behind the API key) as
 *   the Agent. Accepts `plan_id`, so the quoted plan arrives pre-selected.
 *   Rejects names and contact details.
 *
 * The office's model is the second one: the agent hands the iPad to the client
 * to finish, stays to answer questions, and only the agency NPN matters. That
 * is why it is the default.
 */
export type EnrollmentFlow = "agent_assisted" | "self_service";

export function isEnrollmentFlow(v: unknown): v is EnrollmentFlow {
  return v === "agent_assisted" || v === "self_service";
}

/** The flow the live handoff uses. Changed in one place, on purpose. */
export const DEFAULT_FLOW: EnrollmentFlow = "self_service";

/** No SSN field exists on this endpoint, at any nesting level. */
export interface EnrollmentSessionLinks {
  /** Pre-filled application. Where the agent goes to enroll the client. */
  clientApplyUrl: string;
  /** Pre-filled plan shopping. Null when HealthSherpa omits it. */
  shoppingUrl: string | null;
}

/** HealthSherpa wants lowercase; the draft holds Zoho's capitalised form. */
function hsSex(sex: Person["sex"]): "male" | "female" | undefined {
  if (sex === "Male") return "male";
  if (sex === "Female") return "female";
  return undefined;
}

/**
 * Yes/No/Unknown → boolean, with "not sure" left OFF the payload entirely.
 *
 * Sending `false` for an unanswered eligibility question is an assertion the
 * agent never made, and these answers change the Medicaid/CHIP screening path.
 */
function tri(value: string): boolean | undefined {
  if (value === "Yes") return true;
  if (value === "No") return false;
  return undefined;
}

/**
 * Annual dollar figures → `income_sources[]`.
 *
 * The spec's shape is `{ employer?: string, amount: number }` with `amount`
 * required and annual. Our capture is four flat numbers, which is a documented
 * mismatch: HealthSherpa's own screens ask per person, per source, MONTHLY.
 * See "The structural gap: income" in docs/healthsherpa-contract.md.
 *
 * So this is lossy in one direction only — a flat annual total becomes one
 * source rather than the itemised table the office reconstructs today. That is
 * strictly better than sending nothing, and it does not invent detail we never
 * captured. Zero and null are dropped: `amount` is required, so an empty entry
 * would fail the request.
 */
function incomeSources(
  entries: Array<{ amount: number | null; employer?: string }>,
): Array<{ amount: number; employer?: string }> {
  return entries
    .filter((e) => typeof e.amount === "number" && e.amount > 0)
    .map((e) => ({
      amount: e.amount as number,
      ...(e.employer && e.employer.trim() !== "" ? { employer: e.employer.trim() } : {}),
    }));
}

/**
 * Build the session request.
 *
 * Pure and exported so the payload is testable without a key or a network —
 * which is the only way it can be checked at all while the endpoint 403s.
 *
 * @param formId the Jot's `Name`, passed as `external_id` so the CRM record and
 *               the HealthSherpa session share ONE identifier. A CSR can search
 *               either system with the same string; there is no join table.
 */
export function draftToEnrollmentSession(
  draft: CaptureDraft,
  formId: string,
  flow: EnrollmentFlow = DEFAULT_FLOW,
): Record<string, unknown> {
  const effective = draft.requestedEffective;
  const agentAssisted = flow === "agent_assisted";

  /* At most one `primary` and at most one `spouse` are permitted. The draft
   * carries an explicit relation per person, so this reads it rather than
   * inferring from position and age the way IM-Website's public route has to —
   * but a draft with two spouses on it must still not fail the whole call, so
   * the extras demote to `dependent`. */
  let primaryTaken = false;
  let spouseTaken = false;

  const applicants = draft.people
    .filter((p) => p.seekingCoverage)
    .map((p, index) => {
      let relationship: "primary" | "spouse" | "dependent" = "dependent";
      if (p.relation === "primary" && !primaryTaken) {
        relationship = "primary";
        primaryTaken = true;
      } else if (p.relation === "spouse" && !spouseTaken) {
        relationship = "spouse";
        spouseTaken = true;
      }

      const isPrimary = relationship === "primary";
      const isSpouse = relationship === "spouse";
      const sex = hsSex(p.sex);
      const pregnant = tri(p.pregnant);

      /* ── Household answers, sent on the primary only ────────────────────
       * The session models these PER APPLICANT, but the draft holds one answer
       * each — because the Jot does too: `Jot_Dependents` has columns only for
       * Address, SSN, First, Last, DoB, Gender, Relation and Coverage, so
       * there is nowhere to put a per-dependent answer.
       *
       * Attaching a household-level answer to the primary is the least wrong
       * option: it is the applicant the question was asked about, and putting
       * it on everyone would assert it of people who were never asked. */
      const medicaidRejected = isPrimary ? tri(draft.medicaidChipDenied90d) : undefined;
      const unemployment = isPrimary ? tri(draft.unemployment) : undefined;
      const parentCaretaker = isPrimary ? tri(draft.parentCaretaker) : undefined;
      const hasExistingCoverage = isPrimary ? tri(draft.existingCoverage) : undefined;

      /* Employment income belongs to whoever earned it; "other" income has no
       * owner in our capture, so it goes to the primary. */
      const sources = incomeSources(
        isPrimary
          ? [
              { amount: draft.employmentIncome, employer: draft.employer },
              { amount: draft.otherIncome },
            ]
          : isSpouse
            ? [{ amount: draft.spouseEmploymentIncome }]
            : [],
      );

      return {
        relationship,
        /* Names and primary contact details are accepted in the
         * `agent_assisted` flow ONLY; in `self_service` an unsupported key
         * fails the whole request with 400. The client types their own name
         * over there, which is the right person to be typing it. */
        ...(agentAssisted && p.firstName ? { first_name: p.firstName } : {}),
        ...(agentAssisted && p.lastName ? { last_name: p.lastName } : {}),
        ...(agentAssisted && isPrimary && draft.email ? { email: draft.email } : {}),
        ...(agentAssisted && isPrimary && draft.phone ? { phone_number: draft.phone } : {}),
        /* Mutually exclusive with `age`, so `age` is never sent. DoB is what
         * the draft holds and it is strictly better information. */
        ...(p.dateOfBirth ? { date_of_birth: p.dateOfBirth } : {}),
        ...(sex ? { sex } : {}),
        uses_tobacco: p.tobacco,
        ...(pregnant !== undefined ? { pregnant } : {}),
        ...(medicaidRejected !== undefined
          ? { rejected_by_medicaid_or_chip: medicaidRejected }
          : {}),
        ...(unemployment !== undefined ? { unemployment } : {}),
        ...(parentCaretaker !== undefined ? { parent_caretaker: parentCaretaker } : {}),
        ...(hasExistingCoverage !== undefined
          ? { has_existing_coverage: hasExistingCoverage }
          : {}),
        ...(sources.length ? { income_sources: sources } : {}),
      };
    });

  const employerCoverage = tri(draft.employerCoverageOffer);

  const planId = draft.selectedPlan?.planId;

  return {
    /* `plan_id` is accepted in `self_service` ONLY — in `agent_assisted` it
     * 400s the whole request. Where it is allowed it is the single biggest
     * win of the handoff: the plan the agent quoted arrives pre-selected
     * instead of being found again on HealthSherpa. */
    ...(!agentAssisted && planId ? { plan_id: planId } : {}),
    external_id: formId,
    context: {
      product: "aca",
      exchange: "on_exchange",
      coverage_family: "medical",
      coverage_type: "medical",
      plan_year: effective ? Number(effective.slice(0, 4)) : new Date().getFullYear(),
      flow,
      /* The one value here that changes what the CLIENT sees: es-MX puts them
       * into HealthSherpa's Spanish flow. Defaults to English when unanswered
       * rather than guessing from a name or a state. */
      locale: draft.preferredLanguage === "Spanish" ? "es-MX" : "en-US",
    },
    location: {
      zip_code: draft.zip,
      fips_code: draft.county?.fipsCode ?? "",
      state: draft.county?.state ?? "",
    },
    household: {
      household_size: effectiveHouseholdSize(draft),
      ...(typeof draft.householdIncome === "number"
        ? { annual_income: draft.householdIncome }
        : {}),
      ...(employerCoverage !== undefined
        ? { someone_has_employer_coverage: employerCoverage }
        : {}),
      applicants,
    },
  };
}

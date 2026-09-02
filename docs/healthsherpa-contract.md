# HealthSherpa's application contract

**Source: `https://one.healthsherpa.com/openapi.json`** — OpenAPI 3.1, "HealthSherpa
Public API" v0.1.0. Machine-readable and authoritative; fetch it again rather than
trusting this file when they disagree.

Written because the question "what fields does their application need, and in what
format" had no answer in this repo. The capture form was modelled on the *Jot's* field
order, which `IM_CRM_Frontend` derived by watching HealthSherpa's screens — accurate as
far as it went, but second-hand and silent about types.

---

## The finding that matters most

**There is no API to submit an on-exchange ACA application.**

`POST /v1/enrollments` exists and takes a full application, but its own description limits
it:

> Direct enrollment currently supports `context.product = "ichra"` and
> `context.exchange = "off_exchange"`; other products and exchanges are not supported
> here.

On-exchange ACA — which is this app's entire business — goes through
**`POST /v1/enrollment-sessions`**, and that endpoint

> always returns deep links and does not create direct enrollment application records.

So the Phase 2 assumption in `SOFTWARE_SCOPE.md` §6 needs correcting. "Agent Enrollment
API" is not an API that files an application; it is an API that hands a **browser** to
HealthSherpa with the household pre-filled, and a person finishes it there. The response
is two URLs:

| Field | Meaning |
|---|---|
| `links.shopping_url` | HealthSherpa public shop URL |
| `links.client_apply_url` | HealthSherpa public apply URL |

Set `context.flow = "agent_assisted"` for an agent walking a client through, or
`"self_service"` for the client alone. `plan_id` and the `campaign` block are accepted
**only** in self-service.

What that means for us: the field app's job stays what it is — capture accurately, file
the Jot, hand off. It removes the hope that an agent could complete an enrollment without
ever leaving this app, and it makes the transcription the office does today reducible but
not eliminable.

---

## The on-exchange path: `POST /v1/enrollment-sessions`

### `context` — all required

| Field | Type |
|---|---|
| `product` | `"aca"` |
| `exchange` | `"on_exchange"` |
| `coverage_family` | `"medical"` |
| `coverage_type` | `"medical"` |
| `plan_year` | integer |
| `flow` | `"agent_assisted"` \| `"self_service"` |
| `locale` | `"en-US"` \| `"es-MX"` — `es-MX` enables the Spanish flow |

### `household`

| Field | Type | Notes |
|---|---|---|
| `annual_income` | number | |
| `household_size` | integer | at least 1 |
| `someone_has_employer_coverage` | boolean | |
| `applicants[]` | array | at most one `primary` and one `spouse` |

### `household.applicants[]`

`relationship` is the only required field: `primary` \| `spouse` \| `dependent`.

| Field | Type | Notes |
|---|---|---|
| `first_name`, `last_name` | string | **agent-assisted flow only** |
| `email`, `phone_number` | string | primary applicant only, agent-assisted only |
| `date_of_birth` | date | mutually exclusive with `age`; must not be future |
| `age` | integer | |
| `sex` | `male` \| `female` | |
| `uses_tobacco`, `pregnant` | boolean | |
| `parent_caretaker` | boolean | |
| `rejected_by_medicaid_or_chip` | boolean | |
| `unemployment` | boolean | |
| `has_existing_coverage` | boolean | |
| `income_sources[]` | array | `{ employer?: string, amount: number }` — `amount` required, annual dollars |
| `prescriptions[]`, `ichra` | | out of scope here |

⚠️ **`client` is deprecated.** The legacy `client.first_name` / `last_name` / `email` /
`phone_number` block has 1:1 replacements on `household.applicants[primary]`, and the
applicant version wins when both are sent. Our ported route from `IM-Website` should be
checked against this before Phase 2.

⚠️ **Unknown fields are rejected**, not ignored: "Unsupported fields anywhere in the body
are rejected with `400 invalid_request`."

---

## The full application schema (`ApplicationCreateRequest`)

Off-exchange ICHRA only today, but it is the best available statement of what HealthSherpa
considers a complete ACA application — and therefore what our capture form is ultimately
transcribed into. Worth reading even though we cannot post to it.

Required at the root: `plan_hios_id`, `applicants`, `residential_address`.

Also accepted: `external_id`, `agent_of_record`, `plan_year`,
`desired_effective_date` (date), `mailing_address`, `hra`, `special_enrollment_period`,
`attestations`, `signatures`, `communication_preferences`,
`american_indian_or_alaskan_native_in_household`, `analytics`.

### `ApplicantBase` — 37 fields

Formats worth pinning:

| Field | Spec |
|---|---|
| `ssn` | string — **"9 digits, no dashes. Encrypted at rest."** |
| `itin` | string — alternative to SSN |
| `date_of_birth`, `graduation_date`, `disability_end_date` | `format: date` |
| `gender` | `male` \| `female` \| `x` — but a **`Dependent`'s `gender` is required and allows only `male` \| `female`** |
| `suffix` | `Jr.` \| `Sr.` \| `II` \| `III` \| `IV` \| `V` |
| `email` | `format: email` |
| `phone` | plain string, no pattern given |
| `race_ethnicity` | 13-value enum |
| `hispanic_origin` | `yes` \| `no` \| `decline_to_answer` |

Booleans, all optional: `married`, `us_citizen`, `resides_in_state`, `uses_tobacco`,
`tobacco_not_applicable`, `full_time_student`, `has_disability`,
`disability_is_temporary`, `medicare_mediaid_eligible`, `medicare_eligible`,
`enrolled_in_medicare`, `enrolled_in_medicare_parts_a_or_b`,
`enrolled_in_medicaid_chip_or_other_gov_program`, `veteran_or_active_duty_military`,
`currently_incarcerated`, `has_eligible_immigration_status`,
`add_to_donate_life_registry`.

### `Dependent` = `ApplicantBase` +

- `gender` — **required**, `male` \| `female` only
- `relationship` — **required**: `spouse` \| `domestic_partner` \| `child` \| `parent` \|
  `stepparent` \| `parent_in_law` \| `sibling` \| `other`
- `alternate_address`, `guardian`

### `Address`

Required: `street_address_1`, `city`, `state`, `zip_code` (`^\d{5}$`).
Optional: `street_address_2`, `fips_code`.

### `SpecialEnrollmentPeriod`

`event_date` (date) and `event_type` — **28 values**:

```
birth, adoption, death, divorce, marriage, domestic_partnership, child_support,
loss_of_mec, loss_of_dependent, dependent_lost_coverage, loss_of_pregnancy_coverage,
end_of_non_calendar_year_policy, change_in_household_status, lost_aptc, relocation,
nj_county_change, offered_ichra, offered_qsehra, mandated_covered_dependent,
released_from_incarceration, returning_active_duty,
provider_not_participating_in_prior_plan, issuer_violated_contract, misinformed,
domestic_abuse, family_care_app_ineligible, pregnancy, other
```

Our capture form offers six. See the gaps below.

### `ExistingCoverage`

`has_existing_coverage`, `plan_replaces_existing_coverage`, `type` (`issuer` \|
`government`), `insurer`, `policy_id`, `policyholder_name`, `start_date`, `term_date`,
`will_continue`.

### `Attestations` and `Signatures`

Twelve attestation booleans, four of which are specifically about the agent:
`agent_submitted_application`, `agent_provided_consumer_marketing_materials`,
`agent_advised_consumer_of_product_features`, `agent_retained_signed_application_copy`,
plus `consumer_working_with_agent` and `broker_signature_attestation`.

`Signatures` carries `signature_date` and several state-supplement signature fields.

**This is the compliance surface** open question 7 in `SOFTWARE_SCOPE.md` was about. It
now has a concrete shape: HealthSherpa expects the agent's attestations and a signature
date, so if the office is asserting those on an agent's behalf today, the field app is
where they should actually be captured.

### `AgentOfRecord`

`first_name`, `last_name`, `national_producer_number`, `carrier_producer_code`,
`state_license_number`, `email`, `phone`, `fax_number`, `address`, `signature`.

Relevant to §4.7: this confirms the NPN on an application is the **agent of record's**,
which is why the field app does not write `Agent_NPN`.

---

## Gaps between our capture form and the contract

Not a to-do list — most of these belong to the office, not the field. Recorded so the
choice is deliberate.

**Format corrections to make now**

1. **SSN to HealthSherpa is 9 digits, no dashes.** Our draft already holds raw digits, so
   this is right by accident rather than design — `lib/ssn.ts` formats to dashes only for
   Zoho, which stores `XXX-XX-XXXX`. Keep both, and keep them labelled.
2. **`sex`/`gender` values are lowercase** (`male`, `female`), not `Male`/`Female`. Our
   capture stores the capitalised form for Zoho. A translation is needed at the
   HealthSherpa boundary, not a change to what we store.

**Worth adding to capture**

3. **The SEP event list should be the full 28**, or at least the ones the office actually
   sees. Six options means an agent picks "Other" for a `loss_of_mec` that has its own
   code — and the office then has to work out which.
4. **`parent_caretaker`, `rejected_by_medicaid_or_chip`, `unemployment`** are accepted by
   the enrollment session and affect Medicaid/CHIP screening. Cheap to ask, and they
   change the eligibility path.
5. **`someone_has_employer_coverage`** at household level — a single question that changes
   affordability.

**Deliberately not capturing**

6. `race_ethnicity`, `hispanic_origin`, `language_spoken`/`written`,
   `add_to_donate_life_registry` — optional demographics. Collecting them means storing
   more about a client than the enrollment needs, and they can be declined on
   HealthSherpa's own flow.
7. The Medicare/Medicaid/disability/incarceration/immigration booleans — these are
   eligibility questions the exchange asks directly, and a wrong answer from a field agent
   is worse than no answer.

---

## Other endpoints in the spec

Not currently used, listed because two of them change what is possible.

| Endpoint | Note |
|---|---|
| `GET /v1/policy-status/applications` | **The Status API.** Application status and effectuation — Phase 2 in the scope doc. Also `/{confirmation_id}` for one. |
| `GET /v1/reference/issuers` | Carrier reference data. Could replace pinned carrier names. |
| `GET /v1/reference/providers` | Doctor search — a real agent ask ("is my doctor in network"). |
| `GET /v1/reference/counties` | Already used. |
| `POST /v1/enrollments/{id}/submissions` | Submit a created application. Off-exchange only. |
| `.../cancellations`, `.../terminations` | Policy lifecycle. Off-exchange only. |
| `.../supporting_documentation` | Document upload — relevant to the `Required_Documents` flow. |
| `.../payment_redirect` | First-payment handoff. |
| `GET /v1/ping` | Credential check. Cheaper than a quote for a health probe. |

`api_enrollable` on a quoted plan is worth watching: the plans returned for Maricopa AZ
all came back `false`, which is consistent with on-exchange having no direct enrollment
API at all.

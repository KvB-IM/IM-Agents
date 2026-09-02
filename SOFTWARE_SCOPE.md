# IM Agent Portal — Build Scope

> **Status:** scope only. No code in this repo yet.
> **Companion documents:** [`IM-Website`](../IM-Website) supplies the HealthSherpa and
> Zoho service-account patterns this app lifts from; [`IM_CRM_Frontend`](../IM_CRM_Frontend)
> supplies the JOTS field mapping and is the back-office counterpart to this app.

**Purpose of this document.** A functional scope for a field-agent enrollment app. It was
produced by inventorying two existing production systems and identifying what already
works, what must be adapted, and what has to be built new. Architecture inside the fixed
requirements is open; the fixed requirements exist because they are security boundaries or
because working code already settles the question.

---

## 1. What the product is

Insurance Masters field agents enroll ACA clients in person, on iPads, away from the
office. They have no Zoho CRM accounts and will not be given any.

This app gives them the four things that job needs:

1. **Quote** — run an ACA on-exchange quote at the kitchen table.
2. **Capture** — take the client's full application data once, accurately.
3. **Submit** — file it into the CRM's `JOTS` module as an enrollment form.
4. **Follow** — see where each submitted form stands, fix what the back office
   flags, and see their own production numbers.

It is deliberately *not* an enrollment platform. The actual application is taken on
HealthSherpa, by the back office today and possibly by the agent in Phase 2. This app
feeds that process and reports on it.

### Who uses it

| Role | Access | What they do |
|---|---|---|
| **Field agent** | App-native account. No Zoho account, ever. | Quotes, captures, submits Jots, fixes flagged problems, sees own KPIs |
| **Agency admin** | App-native account, elevated | Invites and deactivates agents, sees agency-wide rollups |
| **Back office** | Zoho + [`IM_CRM_Frontend`](../IM_CRM_Frontend) | Works the Jot queue, flags problems, enrolls on HealthSherpa. **Not a user of this app.** |
| **Client** | None | Sits next to the agent; signs and provides data |

The field agent is the least-trusted principal that has ever touched this data, and the
data includes SSNs for the applicant and every dependent. Section 7 is therefore not
advisory.

---

## 2. Fixed requirements

These are settled. Everything else is open.

1. **Next.js + TypeScript**, following [`IM-Website`](../IM-Website)'s structure. Not the
   Express/Vite shape of `IM_CRM_Frontend` — the HealthSherpa and Zoho code being lifted
   is Next.js route handlers.
2. **Zoho is reached through a single service-account refresh token**, as
   [`IM-Website`](../IM-Website) already does. Per-user Zoho OAuth — the
   `IM_CRM_Frontend` model — is impossible here by definition.
3. **Because of (2), this app owns its own permission layer.** `IM_CRM_Frontend`'s README
   forbids an app-side permission layer because Zoho enforces one. That reasoning does not
   transfer: with one service identity, Zoho will happily return the entire book to any
   caller. See §7.
4. **Postgres (Neon) for app-owned data.** Already in the stack with migrations in
   [`IM-Website/db`](../IM-Website/db). Agent accounts, sessions, and quote drafts live
   here. Client and enrollment data live in Zoho; this database is never a second copy of
   the book of business.
5. **The HealthSherpa API key is server-only.** Lifted verbatim from
   [`IM-Website/src/lib/healthsherpa.ts`](../IM-Website/src/lib/healthsherpa.ts): the
   browser calls our routes, only the server calls `api.one.healthsherpa.com`.
6. **Write allowlists are the safety boundary, not payload hygiene.** A Zoho field absent
   from an allowlist can never be written, whatever the client sends. This is the
   convention in both existing apps and it is kept.
7. **Attribution is stamped server-side from the session.** `Submitting_Field_Agent` and
   `Agent_NPN` are never read from a request body.

---

## 3. Systems of record

| Data | Lives in | Notes |
|---|---|---|
| Agent identity, sessions, invitations | This app's Postgres | New. Nothing existing to reuse. |
| In-progress quotes and drafts | This app's Postgres | Expires; see §4.3 retention |
| Plan and rate data | HealthSherpa, live | Never cached as a source of truth — rates change |
| Submitted enrollment forms | Zoho `JOTS` | Created by this app, worked by the back office |
| Clients and policies | Zoho `Contacts` / `Deals` | This app reads little and writes none of it in Phase 1 |
| Enrollment status | Zoho `JOTS` fields (Phase 1), HealthSherpa Status API (Phase 2) | |

**Zoho module facts** (confirmed in
[`IM_CRM_Frontend/server/lines/aca.js`](../IM_CRM_Frontend/server/lines/aca.js)):

- Module API name: `JOTS`
- Client link field: `Client` (lookup to `Contacts`)
- Dependents subform: `Jot_Dependents`
- Form identifier: `Name`, labelled "Form ID" in Zoho
- Submitting-agent chain: `Submitting_Field_Agent`, `Submitting_Sub_Agent`,
  `Submitting_Regional_Manager`, plus `Enroller` and `Agent_NPN`
- Status surface: `Jot_Status`, `Classification`, `Enrollment_Stage`, `Requirement_Stage`,
  `Requirement_Due_Date`, `Required_Documents`, `Problems` (multi-select), `Policy`
  (lookup to the converted policy)

⚠️ **Subform rows only come back on a single-record read.** A multi-record `ids=` fetch
silently omits them. `IM_CRM_Frontend` learned this the hard way; do not rediscover it.

---

## 4. Functional scope

### 4.1 Identity and access

- App-native accounts: email plus password or magic link. Admin-invited only — **no
  self-service registration**. A field agent account is a key to client PII.
- Per-agent record: name, email, **NPN**, agency, upline (sub-agent / regional manager, to
  populate the Jot's submitting chain), lifecycle `invited → active → inactive`.
- Real session expiry and **server-side revocation**. An iPad gets lost; deactivating an
  agent must end their sessions immediately, which rules out stateless-JWT-only auth.
- Strong password policy, modern password hashing, working password reset.
- MFA is expected at launch for a role that carries SSNs on a mobile device.

⚠️ **Anti-requirements**, taken from the ICHRA post-mortem
([`ICHRA_Masters/SOFTWARE_SCOPE.md`](../ICHRA_Masters/SOFTWARE_SCOPE.md) §4.1) because the
same mistakes are available here: no non-expiring tokens, no unsalted password hashes, no
staging backdoor, no impersonation-by-query-parameter, no UI-only password reset.

### 4.2 Quoting

Lifted from [`IM-Website/src/app/api/hs/quotes/route.ts`](../IM-Website/src/app/api/hs/quotes/route.ts)
and [`counties/route.ts`](../IM-Website/src/app/api/hs/counties/route.ts), which are
production-working today against a self-serve HealthSherpa key.

- `GET /api/hs/counties?zip_code=` → `/v1/reference/counties`. **Must run first**: quoting
  requires a `fips_code`, and a ZIP can span several counties, so the agent picks one.
- `POST /api/quote` → `/v1/quotes`. Context is `product: aca`, `exchange: on_exchange`,
  `coverage_family/type: medical`, `plan_year` derived from the effective date. Returns
  premium, APTC, net cost and rating area, premium-sorted and paged.
- Relationships are assigned positionally by the existing route: first applicant primary,
  first additional adult 18+ spouse, everyone else dependent.
- Off-exchange quoting is also self-serve on the HealthSherpa account and adds roughly
  three-quarters of the individual market. Out of Phase 1 scope; the route generalizes.

**The one adaptation:** the website route accepts `age`. The Jot requires `DoB` per person
and an explicit `Relation`. **Capture DOB and derive age at the effective date** — never
ask twice, and never store age as the primary value. This inverts the direction of the
existing code: capture is now the rich record and the quote payload is a projection of it.

### 4.3 Capture

The application form, on an iPad, in HealthSherpa's screen order.

- **Field order and grouping are already solved.** `JOT_FIELDS` in
  [`aca.js:127`](../IM_CRM_Frontend/server/lines/aca.js:127) is deliberately ordered to
  match the HealthSherpa application screens, step by step: identity, addresses and
  contact, household and tax household, per-person eligibility, income and deductions,
  existing coverage and the SEP qualifying event, then plan selection. Reuse that order.
  An agent working down this form and a back-office enroller working down HealthSherpa are
  then reading the same sequence.
- **The capture allowlist is new and larger than the existing one.** `enrollments.writable`
  in [`aca.js`](../IM_CRM_Frontend/server/lines/aca.js) is the *enroller's correction* set
  — about 25 fields. Capture needs the whole application: citizenship and naturalization,
  full-time student, tobacco, tax filing intent and joint filing, existing coverage type
  and loss dates, the enrollment event and type, and the `Jot_Dependents` rows. Build it as
  a separate allowlist; do not widen the enroller's.
- **Dependents** use the `Jot_Dependents` subform: `First`, `Last`, `Relation`, `DoB`,
  `Gender`, `Coverage`, `SSN`.
- **Picklist values must be pinned or fetched, not free-typed.** Both existing apps note
  that a free-text box which silently fails Zoho validation is worse than no box.
  `IM_CRM_Frontend` serves picklists at `/api/meta/picklists`; do the equivalent.
- **Drafts persist server-side and resume.** Field connectivity is unreliable and a
  half-finished application must survive a dropped connection, a locked iPad, and a
  same-day second visit. `IM-Website` already has a resume-by-code mechanism
  (`/quote/resume/[code]`, `Resume_Code`) to model on.
- **Drafts expire.** A draft holds unsubmitted PII including SSNs. Set a retention window
  and enforce it in the database, following
  [`IM-Website/db/003_retention_policy.sql`](../IM-Website/db/003_retention_policy.sql).

### 4.4 Submit

New. No create path exists in either app today — `IM_CRM_Frontend` only PATCHes existing
Jots, because Jots currently arrive from JotForm.

- `POST /api/enrollments` creates a `JOTS` record through the capture allowlist.
- Server stamps `Submitting_Field_Agent`, `Agent_NPN`, and the upline chain from the
  session. Client-supplied values for these are rejected, not overwritten.
- Sets `Method` and `Form_Type` to identify this app as the origin, so the back office can
  tell an agent-portal submission from a JotForm one and the two can be reported on
  separately.
- **Plan selection carries through from the quote.** The selected plan writes to
  `Carrier_HIOS_ID`, `Plan_HIOS_ID`, `Premium`, `Requested_Effective_Date`, and the
  carrier/plan text fields. The same HealthSherpa `plan_id` is what
  `/v1/enrollment-sessions` will want in Phase 2, so keep it.
- **Client matching is the back office's job, not the agent's.** The Jot has `Matched_Client`
  and `IM_CRM_Frontend` has a whole match workflow at `/api/enrollments/:id/match`. The
  agent submits a form; a human decides whether it is an existing client. Do not
  auto-link.
- Submission must be **idempotent**. A tapped Submit on a flaky connection must not create
  two Jots — use a client-generated submission key.

### 4.5 Status and corrections

The agent's own work queue, and the reason the back office's flags become useful.

- Read the agent's own Jots and show `Jot_Status`, `Enrollment_Stage`, `Requirement_Stage`,
  `Requirement_Due_Date`, and — once converted — the linked `Policy`.
- **`Problems` and `Required_Documents` become the agent's task list.** The back office
  already writes these fields; today nothing shows them to the person who can fix them.
- Corrections write back through a **narrow** allowlist — the applicant's own data, not the
  enroller's pipeline fields. `Enrollment_Stage`, `Enrollment_Date`, `FFM_Application_ID`,
  `FFM_Subscriber_ID` and `Problems` belong to the back office and must be unwritable from
  this app.
- **Document capture reuses existing plumbing.** `IM_CRM_Frontend` has a direct-to-blob
  upload flow (`POST /api/uploads/token` → `POST /api/attachments/:module/:recordId/staged`,
  `@vercel/blob`). An agent photographs a document with the iPad camera and it lands on the
  Jot as an attachment. Port this rather than inventing an upload path.
- Note that `Enrollment_Stage` is not yet on any Zoho layout and is empty on every record
  today — `IM_CRM_Frontend` documents this. Status display must degrade gracefully to
  `Jot_Status` until that field is populated in practice.

### 4.6 KPIs

Per-agent, scoped to `Submitting_Field_Agent`, and built almost entirely on
**`Enrollment_Stage`**.

**Confirmed against the live CRM by COQL.** The field is populated — the comment
in `IM_CRM_Frontend` saying it is empty on every record is out of date. The
complete set of values in use is:

| Stage | Meaning to the agent |
|---|---|
| *(null / empty)* | Submitted; the office has not picked it up yet |
| `Ready to Enroll` | Validated and queued. Nothing needed from the agent |
| `Awaiting Enrollment` | Held — usually waiting on a document or an answer |
| `Enrolling` | The office is on the exchange with it now |
| `Enrolled` | Coverage is in place |
| `Failed to Enroll` | Did not go through; expect a request from the office |

⚠️ **How to enumerate these correctly.** A bare `not in (...)` fills its page
with the many null-stage historical records and never reaches the rare non-null
outliers — which is how `Awaiting Enrollment` was missed on a first pass and
this list was briefly believed to be four values. The query must pin both halves:

```sql
select Enrollment_Stage from JOTS
where Enrollment_Stage is not null
  and Enrollment_Stage not in ('Enrolled', 'Failed to Enroll',
      'Ready to Enroll', 'Enrolling', 'Awaiting Enrollment')
```

That returns nothing today. `Requirement_Stage`, checked the same way, has one
value in use (`Unworked`) on a single record — the requirement workflow is
barely exercised, so the agent-facing requirement UI should degrade gracefully.

Two consequences the implementation must respect:

1. **Null is a first-class bucket, not an error.** The field was created
   2026-08-25 and back-filled only partly, so a large body of historical forms
   carry null. Dropping them understates an agent's book; folding them into
   `Ready to Enroll` overstates what the office has picked up.
2. **An unrecognised value must render, not vanish.** A stage added in Zoho
   later has to appear in the funnel — labelled verbatim — rather than silently
   disappearing from the agent's totals.

**No monetary figures anywhere on an agent screen.** No premium written, no
average premium, no commission. A field agent's KPIs show movement — where the
forms are, and which ones are waiting on them. Premium is the office's basis of
record and putting it on this screen invites an argument this app cannot settle.

Phase 1 metrics:

- Count per stage, with each stage's share of the agent's book
- Enrolled as a share of forms that **resolved** (`Enrolled` + `Failed to
  Enroll`), not of everything submitted — otherwise forms still in flight drag
  the number down. Null until something resolves.
- Forms submitted, and submitted this month
- Waiting on you: forms carrying `Problems` or `Required_Documents`
- Not staged yet
- Sitting still: not terminal, no movement in 21 days

Agency admins see the same, rolled up across their agents.

**Do not** put an agent's numbers behind a filter the caller supplies. The agent
id comes from the session, the same way §7 requires for every other read.

### 4.7 Attribution, and what NOT to write

`Agent_NPN` is **not** the field agent's number and this app must neither write
nor display it. A field agent is not the NPN of record on these enrollments —
the accredited enrolling agent is, and the office owns that field. No screen
should tell an agent a form was filed "under your NPN".

Attribution runs through **`Submitting_Field_Agent`**, which Zoho labels
"Accredited Field Agent". Field metadata confirms it is a **picklist backed by
the `Agent` global picklist** (id `5102272000006932237`) — not a user lookup and
not free text. So:

- Scope filtering compares a **name**, which is the only comparison available.
- An agent absent from that global picklist **cannot be attributed at all**.
  Onboarding a field agent is a Zoho picklist change as well as an account in
  this app, and the admin flow has to say so.

## 5. Quote payload → Jot field mapping

The capture record is the source; both the quote request and the Jot are projections of
it. This is the join that makes "capture once" work.

| Captured | → Quote request | → Jot field |
|---|---|---|
| ZIP | `location.zip_code` | `Home_Zip` |
| County (chosen from `/v1/reference/counties`) | `location.fips_code` | `Mailing_County` |
| State | `location.state` | `Home_State` |
| Street, city | — | `Home_Street`, `Home_City` |
| Household size | `household.household_size` | `Household_Size` |
| Annual household income | `household.annual_income` | `Household_Income` |
| Requested effective date | `household.effective_date`, and `plan_year` | `Requested_Effective_Date` |
| **DOB** per person | `applicants[].age` *(derived at effective date)* | `DoB`, and `Jot_Dependents[].DoB` |
| Relation per person | `applicants[].relationship` *(positional)* | `Jot_Dependents[].Relation` |
| Tobacco per person | `applicants[].uses_tobacco` | `Tobacco` |
| First / last name | *(enrollment session only)* | `First_Name`, `Last_Name`, `Jot_Dependents[].First`/`.Last` |
| Email, mobile, home phone | *(enrollment session only)* | `Email`, `Phone`, `Home_Phone` |
| Sex | — | `Gender` *(HealthSherpa labels this "Sex"; same value)* |
| SSN per person | — | `SSN`, `Jot_Dependents[].SSN` — see §7 |
| Selected plan | `plan_id` *(Phase 2)* | `Plan_HIOS_ID`, `Carrier_HIOS_ID`, `Plan1`, `Carrier1`, `Premium` |
| Income detail | — | `Employment_Income`, `Spouse_Employment_Income`, `Other_Income`, `Unemployment`, `Dependent_Income` |
| Employer | — | `Employer`, `Employer_Phone`, `Spouse_Employer`, `Spouse_Employer_Phone` |
| Tax household | — | `Household_Type`, `Will_File_Taxes`, `File_Jointly`, `Filed_Taxes` |
| Eligibility answers | — | `US_Citizen`, `Naturized_or_Derived`, `Fulltime_Student` |
| Existing coverage | — | `Existing_Insurance_Coverage`, `Type_of_Existing_Coverage`, `Coverage_Loss_Date`, `Medicare_Loss_Date` |
| SEP event | — | `Enrollment_Event`, `Enrollment_Type`, `Qualifying_Event_Date`, `Reenrolling` |
| Session (not captured) | — | `Submitting_Field_Agent`, `Agency`, `Method`, `Form_Type` — **never** `Agent_NPN`, see §4.7 |

Note `Naturized_or_Derived` — the misspelling is Zoho's actual API name. Both existing
apps carry it as-is; do not "fix" it.

---

## 6. Phase 2 — HealthSherpa enrollment

Gated on HealthSherpa partnership onboarding, not on engineering. Deliberately kept out of
Phase 1's critical path.

Current account state, as recorded in
[`healthsherpa.ts`](../IM-Website/src/lib/healthsherpa.ts): quoting works; enrollment
endpoints return 401/403 with *"not authorized to access this endpoint"*.

| API | Access today | Use |
|---|---|---|
| On-exchange quoting | **Self-serve, working** | §4.2 |
| Off-exchange quoting | Self-serve | Future breadth |
| Status API | Available | Real application status and effectuation, replacing inference from `Jot_Status` |
| Agent Enrollment API | Partnership review | Agent submits the real application from this app |
| Enrollment Session API | Partnership review | Already coded in `IM-Website`, currently 403 |

When access lands:

1. `POST /v1/enrollment-sessions` is **already written and validated** in
   [`IM-Website`](../IM-Website/src/app/api/hs/enrollment-sessions/route.ts), including an
   `HS_ENROLLMENT_MOCK` mode that renders the exact payload without calling out. Port it.
   Note it is built as `flow: "self_service"` — the agent flow and NPN attribution are the
   part that changes.
2. The Status API replaces polling Zoho for status, and adds effectuation, which the CRM
   has no field for today.

### Worth flagging beyond this app

`IM_CRM_Frontend`'s enrollment UI exists **because there is no HealthSherpa API
integration**: the Jot card is explicitly built as a "transcription script" with a copy
button on every field, and a human retypes each form into HealthSherpa by hand. Agent
Enrollment API access would remove that manual step entirely. That is plausibly a larger
operational win than this app, from the same vendor conversation.

---

## 7. Security requirements

Not a section to skim. Phase 1 moves SSNs for applicants and dependents onto mobile
devices held by the least-trusted principals in the system, and replaces Zoho's own
permission enforcement with code written here.

1. **Tenant scoping must be structural, not remembered.** Every Zoho read on behalf of an
   agent is filtered to `Submitting_Field_Agent = <session agent>`. Implement this as a
   query builder that *cannot be constructed without* an agent id — not as a filter each
   route is trusted to add. A single forgotten `where` clause exposes the entire book of
   business. The ICHRA system leaked across tenants in several endpoints for exactly this
   reason.
2. **SSN is write-only from the field.** An agent may submit an SSN and may not read one
   back — not for their own clients, not masked, not on the correction screen. Re-collect
   rather than display. This removes the whole class of "agent exports the book" risk.
3. **Confirm Zoho-side encryption before first write.** `IM-Website` deliberately routes
   SSN to the encrypted `Leads.SSN` field. **Open item:** verify `JOTS.SSN` and
   `Jot_Dependents.SSN` are Zoho encrypted fields. If they are not, encrypt them in Zoho
   before this app ever posts to them.
4. **No PII in URLs.** `IM-Website`'s mock enrollment preview base64s PII into a query
   string and is therefore hard-gated off in production, because URLs land in browser
   history and access logs. Keep that gate if the mock path is ported.
5. **Attribution is not client input** (§2.7). An agent must not be able to submit a Jot
   as another agent, which is both a PII boundary and a commission one. The value written
   must be the agent's exact entry in the `Agent` global picklist (§4.7).
6. **Compliance flags are state, not styling.** `Do_Not_Contact`, `Email_Opt_Out`,
   `SMS_Opt_Out_3` suppress the `tel:`/`mailto:` link outright wherever contact details
   render. Carried over from `IM_CRM_Frontend`.
7. **Rate-limit quoting per agent.** The HealthSherpa key is shared org-wide and returns
   429s; one agent must not exhaust it for everyone.
8. **Audit every write and every PII read**: who, what record, when, from where.

---

## 8. Open questions

Answer before building the affected area; none of them block starting on §4.1–4.2.

1. **Is `JOTS.SSN` encrypted in Zoho?** Blocks §4.4. See §7.3.
2. **Does a field agent's Jot need `Enroller` set, or only the submitting chain?** Affects
   whether the back office's existing queue filters pick these up correctly.
3. ~~**How are agents mapped onto the `Submitting_*` picklists?**~~ **Answered.**
   `Submitting_Field_Agent` is a picklist backed by the `Agent` global picklist
   (id `5102272000006932237`). Onboarding a field agent therefore requires adding them
   to that global picklist in Zoho — build it into the admin flow. See §4.7.
4. **Should `Agency` on the Jot come from the agent's record or the client's?** The
   delinquency desk allowlists agencies by exact string and a near-miss silently matches
   nothing.
5. **Do agents need to read existing clients at all in Phase 1?** Scope assumes no — they
   submit forms, the back office matches. If agents must service their existing book, §7.1
   and §7.2 get considerably harder.
6. **Offline capture, or online-only?** True offline means PII at rest on the iPad and a
   sync-conflict model. Recommendation: online-only with resilient server-side drafts
   (§4.3), which covers flaky connectivity without the offline data-at-rest problem.
7. **What signature and consent capture is legally required** at the point the agent
   submits, versus at HealthSherpa? Affects §4.4 and whether Phase 1 needs signature
   capture at all.
8. **Is there an existing Zoho report or definition of "agent production"** the KPIs should
   match, so this app and the office agree on the numbers? Specifically: does the office
   count a re-submission as its own form, and does it measure enrolled against everything
   submitted or only against forms that resolved?
9. **Should the office back-fill `Enrollment_Stage` on historical forms?** Until it does,
   an agent's oldest work shows as "not staged yet" forever, which reads as neglect rather
   than as a data gap. Purely an operations decision; the app handles either answer.

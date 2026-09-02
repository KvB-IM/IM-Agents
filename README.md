# IM Agent Portal — prototype

Mobile-first ACA quoting, capture and enrollment tracking for Insurance Masters
**field agents**, who have no Zoho CRM accounts and never will.

Build scope: [`SOFTWARE_SCOPE.md`](SOFTWARE_SCOPE.md).

## Connecting it up

Three independent credentials. Each one that is missing degrades to fixtures
rather than breaking, and the header shows a "Fixture data" badge whenever
either upstream is not live. `GET /api/health` reports exactly what is wired.

**1. HealthSherpa** — self-serve key from <https://one.healthsherpa.com/>.
Quoting works on the free tier. Set `HEALTHSHERPA_API_KEY`.

**2. Zoho CRM** — register a Self Client at <https://api-console.zoho.com/> and
generate a refresh token once. Scopes:

```
ZohoCRM.modules.custom.READ
ZohoCRM.modules.custom.CREATE
ZohoCRM.modules.custom.UPDATE
ZohoCRM.coql.READ
ZohoCRM.settings.fields.READ
```

Do **not** grant DELETE — nothing here deletes a CRM record and the service
account should not be able to. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
`ZOHO_REFRESH_TOKEN`.

**Then add each field agent to Zoho's `Agent` global picklist**, spelled exactly
as `agents.zoho_agent_name`. This is not optional and it fails silently:
`Submitting_Field_Agent` is a picklist backed by that global set, and Zoho drops
a value that is not on it. An unlisted agent files forms attributed to nobody
and then sees an empty pipeline that looks like a new account rather than a
broken one. `/api/health` warns on exactly this case.

**3. Postgres** — `DATABASE_URL`, plus `DRAFT_ENCRYPTION_KEY` for draft SSNs.
Vercel Postgres and Neon are the same engine, so one connection string serves
both. Then `npm run migrate` and `npm run create-agent` — see
**Authentication** below.

Without it there are no accounts, the app runs on a stubbed identity, and the
login screen says so plainly rather than showing a form that cannot work.

## Running it

```bash
npm install
npm run dev
```

Opens on <http://localhost:3000>. **It runs with no credentials at all** — with
`HEALTHSHERPA_API_KEY` unset it serves fixture counties and plans, and a
"Fixture data" badge appears in the header. That convention is borrowed from both
existing apps (`ALLOW_MOCK_DATA` in `IM_CRM_Frontend`, `HS_ENROLLMENT_MOCK` in
`IM-Website`), and it is also how you demo this on an iPad with no signal.

Add a HealthSherpa key to `.env.local` and quoting goes live against
`api.one.healthsherpa.com` with no code change:

```bash
cp .env.example .env.local
```

## What works

| Flow | State |
|---|---|
| **Zoho CRM connection** | **Wired** — service token, COQL reads, create, update |
| Idempotent submission | **Wired** via a unique deterministic Form ID |
| Submission replay buffer | Schema in `db/003`; not yet written to |
| **Login, sessions, sign-out** | **Wired** — scrypt, revocable sessions, throttling |
| Route protection | **Wired** — middleware + `requireAgent` at the data |
| Password reset, invitations, MFA | Schema ready; not built |
| Server-side drafts | Schema in `db/002`; not yet wired |
| ZIP → county (multi-county ZIPs handled) | Real route, fixture fallback |
| Quote: household, DOBs, income → plans with premium/APTC/net | Real route, fixture fallback |
| Application in HealthSherpa step order, 6 steps, dependents | Working, writes through an allowlist |
| Submit → create a `JOTS` record | **Wired** to Zoho; fixtures when unconfigured |
| Pipeline: own forms, stage, problems, required documents | Working |
| KPIs: stage funnel, waiting-on-you, unstaged, stalled | Working |
| Corrections write-back | **Wired**, allowlisted, office fields rejected |
| Document photo upload | Button present, upload not wired |
| HealthSherpa enrollment submission | Phase 2 — needs partnership onboarding |

## Mobile-first, specifically

- **Bottom tab bar.** Used one-handed and standing up; the top of a 6.1" screen
  is out of thumb reach. Four tabs is the limit before targets get too narrow.
- **16px minimum on every control.** iOS Safari zooms the viewport when a
  focused input is under 16px and never zooms back out.
- **44px minimum tap targets** (`.tap`), Apple's floor.
- **Yes/no as segmented buttons, not checkboxes.** A checkbox at 375px is a
  20px target beside a wrapping label.
- **Labels above inputs, never beside.** Side labels wrap badly at 375px.
- **`inputMode`** set per field so the numeric keypad comes up for ZIP, income
  and SSN.
- **Zoom is not locked.** A form asking for dates of birth and SSNs must stay
  zoomable; `maximumScale: 1` is an accessibility failure and iOS ignores it.
- **Safe-area insets** on the header and tab bar for the notch and home
  indicator.
- **Full-bleed containers, inset content.** Below 640px the page has no
  horizontal padding: section containers run edge to edge and separate with
  hairline rules instead of gaps, and only the content inside them is inset by
  16px. A padded page holding padded cards spends the gutter twice — 32px of
  horizontal chrome on a 375px screen, 8.5% of the viewport, before any content.
  This is the iOS Settings / Mail / Messages pattern. What is deliberately not
  done is running *text* to the edge: text needs a margin to be readable and
  rounded display corners clip it, so full-bleed applies to the container and
  never to the words. From 640px up the containers become spaced rounded cards
  again, which is the right shape on an iPad.
- **Quote is one scrolling page; the application is a stepper.** The quote gets
  revised in front of the client — "actually, add my daughter" — so everything
  stays reachable. The application is worked once, front to back, and 40 fields
  on one scroll is where things get skipped.

## Architecture notes

**Capture is the source; the quote and the Jot are both projections of it.**
The app captures **dates of birth** and derives age at the effective date
(`lib/age.ts`). HealthSherpa rates on age, the Jot stores `DoB`, and asking for
both is how the two drift apart. The derived age is displayed next to the date
field, which is also how an agent catches a 1996/1966 typo — invisible as a
date, obvious as an age.

**KPIs are built on `Enrollment_Stage`** (`lib/stages.ts`, `lib/kpis.ts`). The
four live values were confirmed by COQL against the production module —
`Ready to Enroll`, `Enrolling`, `Enrolled`, `Failed to Enroll` — and a query for
anything outside them returns only nulls, so the list is complete. Two things
the code handles because the live data demands it: **null is a real bucket**
("not staged yet" — the field was added 2026-08-25 and only partly back-filled),
and **an unrecognised value renders verbatim** rather than dropping out of the
funnel, so a stage added in Zoho later shows up instead of quietly vanishing.

**No money on any agent screen.** No premium written, no average, no commission.
The KPIs show where forms are and which ones are waiting on the agent. Premium
stays on the record detail because the office reconciles against it, but nothing
in the KPI layer reads it.

**The field agent's NPN is never written or shown.** `Agent_NPN` belongs to the
accredited enrolling agent, not the field agent, so this app leaves it alone and
no screen claims a form was filed "under your NPN". Attribution runs through
`Submitting_Field_Agent` — labelled "Accredited Field Agent" in Zoho, and a
picklist backed by the `Agent` global picklist. **An agent missing from that
picklist cannot be attributed at all**, so onboarding one is a Zoho change as
well as an account here.

**Field mapping lives in `lib/jot.ts`**, implementing section 5 of the scope
doc. Module facts (`JOTS`, `Client`, `Jot_Dependents`, `Submitting_Field_Agent`)
are confirmed against `IM_CRM_Frontend/server/lines/aca.js`.

**The capture allowlist is separate from the back office's.** The office's
`enrollments.writable` is a ~25-field *correction* set; capture needs the whole
application. Widening theirs would have given the field app write access to the
enroller's own pipeline fields.

### Security, and why it looks like this

The faceplate (`IM_CRM_Frontend`) needs no app-side permission layer because it
uses per-user Zoho OAuth and Zoho enforces access itself. That reasoning does
not transfer: this app reaches Zoho through one service connection, so Zoho will
return the entire book of business to any caller. The permission layer is ours.

- **`lib/scope.ts` makes tenant scoping structural.** An `AgentScope` cannot be
  constructed without an agent id, and every read in `lib/store.ts` requires
  one. It is not a `where` clause each route is trusted to remember, because a
  single omission exposes every client in the book.
- **Ownership is checked on single reads too**, not only on lists. A Jot
  belonging to another agent returns 404 rather than 403 — a guessable id must
  not confirm that someone else's client exists.
- **Attribution is stamped server-side** in `draftToJot`, after the allowlist
  gate, so it cannot be spoofed through the request body. An agent must not be
  able to file under another agent's NPN, which is a PII boundary and a
  commission one.
- **SSN is write-only from the field.** Submitted, never read back, not even
  masked. A correction means re-collecting the number. This removes the whole
  "agent exports the book" class of risk.
- **Submission is idempotent** on a client-generated `submissionKey`, so a
  double-tap on bad signal does not file two applications.
- **Corrections are narrow.** An agent can fix the applicant's own data;
  `Enrollment_Stage`, `Enrollment_Date`, `FFM_*`, `Problems` and
  `Classification` are the office's record and are unwritable from the field. An
  agent overwriting the stage would corrupt every KPI that counts it.

Verified in the running app: a foreign Jot id returns 404, a replayed
`submissionKey` returns the original form rather than a duplicate, an attempt to
set `Submitting_Field_Agent` through the request body is ignored, and a PATCH
carrying only office-owned fields (`enrollmentStage`, `problems`,
`classification`, `ffmApplicationId`) is rejected 400 with nothing written.

## The CRM layer

`lib/store.ts` is the seam. With Zoho credentials set it delegates to
`lib/jotsRepo.ts` — real COQL, real creates, real updates. With none it
delegates to `lib/fixtureRepo.ts`. Both take an `AgentScope` on every read;
neither exposes a way to read a Jot without one.

**The scope filter is in the WHERE clause, not applied after the fetch.**
`jotsRepo.getJot` queries `where (id = … and Submitting_Field_Agent = …)`, so
another agent's record is never read into the process at all. It is then
re-asserted on the way out, because that is the one invariant that must never
fail.

**COQL has no parameter binding**, so `lib/coql.ts` is the whole boundary
between an agent name and an injected `WHERE` clause. It is deliberately
import-free — no `server-only`, nothing — so it can be unit-tested directly:

```bash
npm test
```

Seven tests, including the actual attack (`x' or Submitting_Field_Agent != 'zzz`)
and the plausible-but-unqueryable case (an apostrophe in a name, which COQL
cannot escape and which therefore gets its own legible error rather than being
silently mangled).

**A created Jot is read back rather than assumed.** Zoho fires the office's
workflows on create, and whatever stage or status that automation sets is the
truth. If the read-back returns nothing, the app raises loudly and names the
likely cause: `Submitting_Field_Agent` **silently drops a value that is not on
Zoho's `Agent` global picklist**, so an unlisted agent would file forms that
belong to nobody. `GET /api/health` checks for exactly that.

**Workflows are not suppressed.** `createRecord` deliberately does not send
`trigger: []` — a Jot from the field must fire the same office automation as one
from JotForm, or the two intake paths diverge.

## Verified against the production CRM

The read and write paths were proven against the live JOTS module, not just
against fixtures. Four things that only showed up by doing it:

1. **`Name` (Form ID) is `system_mandatory` and unique**, and is not
   auto-numbered — today's values are JotForm submission ids. A create without
   it is rejected. The app now mints `AP-<hash>`, which makes an agent-portal
   form identifiable at a glance **and turns Zoho into the idempotency check**:
   the id is derived from the agent plus their submission key, so a replay is
   refused as `DUPLICATE_DATA` and resolved back to the record already filed.
   That is durable across processes and deploys, unlike the in-memory map it
   replaced.
2. **`Submission_Time` is not auto-populated on an API create.** Left unset it
   comes back null — which would have sorted agent-portal forms differently from
   JotForm ones and silently excluded them from any office report filtering on
   that field.
3. **`Date.toISOString()` is rejected on a Zoho datetime.** A trailing `Z` with
   milliseconds fails with `INVALID_DATA`; an explicit numeric offset is
   required. This would have broken every submission. Pinned by `zohoDateTime`
   and a regression test.
4. **A new form arrives with no status, no stage and no classification.** The
   office's automation does not stamp them on create, so the UI has to read
   correctly on a just-filed form — which is exactly when an agent looks at it.
   The fixture used to invent "Awaiting Validation"; it no longer does.

Also confirmed: the `Agent` picklist contains two generic entries, `Other` and
`Aor`, alongside real agent names. `Other` is the safe value for a write test —
it touches no real agent's pipeline or KPIs.

## Authentication

App-native accounts, admin-created. **No self-service registration** — an
account here is a key to client PII including SSNs.

```bash
npm run migrate                      # apply db/*.sql
npm run create-agent -- --email dana@example.com --zoho-name "Dana Ruiz"
```

The password is prompted for with echo off, never passed as an argument —
anything on a command line lands in shell history and the process list.
Re-running `create-agent` for an existing email resets the password, revokes
that agent's live sessions, and clears their login throttle.

⚠ `--zoho-name` must match the agent's entry in Zoho's `Agent` global picklist
**exactly**, or their forms are attributed to nobody and their pipeline reads
empty. The script says so before it writes.

**Sessions are server-side and revocable.** The cookie carries 32 random bytes;
`agent_sessions` stores only a SHA-256 of it, so a leaked database yields no
working sessions. A lost iPad or a deactivated agent has to lose access *now*,
which a self-contained JWT cannot deliver — that is why it is a table. The
active-status check is in the session query's WHERE clause, so deactivating an
agent kills their live session rather than waiting for expiry.

**Passwords** use scrypt from `node:crypto` — memory-hard, no dependency to
keep patched. Cost parameters travel with each hash, so they can be raised
later without invalidating anyone. The anti-requirement is explicit in the
scope doc: the ICHRA system used unsalted SHA-256.

**Login failures all read the same.** Distinguishing "no such account" from
"wrong password" is a free account-enumeration oracle, and the unknown-email
path still runs a verify against a dummy hash so it costs the same time as a
real one. The precise reason is recorded in `login_attempts` for whoever looks.

**Throttling is in Postgres, not in memory.** On serverless an in-process
counter is per-instance and an attacker gets a fresh allowance with every new
one. Two independent limits: per email (guessing one agent) and per IP (one
common password sprayed across many agents, which never trips a per-email
limit).

**A database outage fails closed.** `agentFromSession` catches, logs and returns
null — the agent lands on the login screen. Treating an error as "signed in"
would be an authentication bypass triggered by taking the database down.

### Where the boundary actually is

`middleware.ts` bounces unauthenticated requests, but it is a **convenience,
not the boundary**. It runs on the Edge runtime with no database access, so it
can only check that a cookie is *present* — a forged or expired one sails
through. The real check is `requireAgent()` in the page or route that touches
data. The matcher is an exclusion list, so a route added later is protected by
default rather than exposed until someone remembers it.

For the same reason `lib/cookies.ts` holds the cookie name and nothing else:
importing it from `auth.ts` dragged `node:crypto` and the Postgres driver into
the Edge bundle, which the build reported as an error against `password.ts` —
a long way from the cause.

## Still scaffolding

1. **No password reset, invitations, or MFA yet.** All three are in scope §4.1
   and the schema is ready for them (`agent_invitations`). Until reset exists,
   a locked-out agent is fixed by re-running `create-agent`.
2. **Drafts live in `sessionStorage`.** They hold SSNs, so the real answer is a
   server-side draft with an enforced expiry (scope §4.3) — `sessionStorage` is
   the wrong place for those on a shared iPad. Needs the same database.
3. **The replay buffer is schema-only.** `db/003` is modelled on
   IM-Website's `lead_submissions`: write a row before the CRM call, update it
   with the outcome after, so an application survives a Zoho failure. Nothing
   writes to it yet. Note the deliberate difference from a naive backup — SSNs
   are redacted from the stored payload, because a second copy of every
   applicant's and dependent's SSN is a larger standing liability than the
   recovery it buys, and the SSN is the one field that can be re-collected.
4. **Document upload is a button.** The port of the CRM app's direct-to-blob
   flow (`/api/uploads/token` → `/api/attachments/:module/:recordId/staged`).
5. **Fixture APTC is a stand-in.** Real subsidy maths is FPL-table driven.
   Fine for a demo, nowhere near enough to quote a client.
6. **Picklist values are pinned in code**, not read from Zoho. `Enrollment_Stage`
   is handled safely either way (an unknown value renders verbatim), but the
   `ZohoCRM.settings.fields.READ` scope is requested in `.env.example` so this
   can be fixed properly.

## Open questions that affect this code

From scope §8, the two that touch what is written here:

- **Is `JOTS.SSN` encrypted at rest in Zoho?** `IM-Website` deliberately routes
  SSN to the encrypted `Leads.SSN` field. Confirm the same for `JOTS.SSN` and
  `Jot_Dependents.SSN` before this app ever posts to them.
- ~~**Is `Submitting_Field_Agent` a user lookup, a name picklist, or free
  text?**~~ **Answered:** a picklist backed by the `Agent` global picklist, so
  the scope filter compares a name, and onboarding a field agent needs a Zoho
  picklist entry as well as an account here.
- **Where does `Awaiting Enrollment` sit in the funnel?** It is ordered after
  `Ready to enroll` on the reading that it means *held* rather than merely
  queued — the single record carrying it also carries an outstanding required
  document and a due date. One record is not evidence; confirm with the office
  before anyone reads the funnel as a sequence.
- **Should the office back-fill `Enrollment_Stage` on historical forms?** Until
  it does, an agent's oldest work reads as "not staged yet" forever, which looks
  like neglect rather than a data gap.

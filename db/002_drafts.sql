-- In-progress applications, held server-side.
--
-- Replaces sessionStorage, which the prototype used and which is the wrong
-- place for this: a draft carries SSNs for the applicant AND every dependent,
-- and iPads get shared, lost and handed to clients. Scope section 4.3.
--
-- It also buys the behaviour the field actually needs. Connectivity at a
-- kitchen table is unreliable, and a half-finished application has to survive a
-- dropped connection, a locked screen, and a second visit the same afternoon.

create table if not exists drafts (
  id            uuid         primary key default gen_random_uuid(),
  agent_id      uuid         not null references agents (id) on delete cascade,
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now(),

  -- Short, human-sayable code so an agent can resume from another device, the
  -- same mechanism IM-Website uses for /quote/resume/[code]. Not secret on its
  -- own: resuming still requires the agent's session, because the code has to
  -- be short enough to read aloud and that makes it guessable.
  resume_code   text         not null,

  -- The capture draft as the client holds it, MINUS the SSN fields — see
  -- ssn_cipher below. Kept as jsonb so the form's field set can change without
  -- a migration, exactly as IM-Website/db/001 does for lead payloads.
  payload       jsonb        not null,

  -- SSNs, encrypted at rest with an app-held key, separate from `payload` so
  -- that a query, a log line, or a jsonb dump of the draft cannot leak them by
  -- accident. Decrypted only when the draft is submitted to the CRM.
  --
  -- The app never reads these back to the browser: SSN is write-only from the
  -- field (scope 7.2). This column exists so a partly-finished application can
  -- be resumed, not so anyone can look one up.
  ssn_cipher    bytea,

  -- Set when the draft has been filed. A submitted draft is kept briefly so a
  -- retry can find it, then purged by 004.
  submitted_at  timestamptz,
  jot_id        text,

  -- Hard expiry, enforced by the purge in 004 and checked on read. A draft is
  -- unsubmitted PII with no system of record behind it, so it must not linger.
  expires_at    timestamptz  not null default now() + interval '14 days'
);

-- Resume codes only need to be unique among drafts still open.
create unique index if not exists drafts_resume_code_key
  on drafts (upper(resume_code))
  where submitted_at is null;

-- "My drafts", the agent's own list.
create index if not exists drafts_agent_idx
  on drafts (agent_id, updated_at desc)
  where submitted_at is null;

-- Drives the purge.
create index if not exists drafts_expiry_idx
  on drafts (expires_at)
  where submitted_at is null;

comment on column drafts.ssn_cipher is
  'Application SSNs, encrypted with an app-held key and stored apart from payload so a jsonb dump or log line cannot leak them. Never returned to the browser.';

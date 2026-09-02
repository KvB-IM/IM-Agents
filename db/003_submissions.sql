-- Safety net for enrollment submissions — the backup copy.
--
-- Directly modelled on IM-Website/db/001_lead_submissions.sql, for the same
-- reason and with the same shape: a row is written BEFORE the CRM call and
-- updated with the outcome after, so a completed application survives any Zoho
-- failure and can be replayed. Until this exists, Zoho is the only place an
-- agent's work ever lands, and a rejected create means a client sat through a
-- full application for nothing.
--
-- ── What this table is NOT ────────────────────────────────────────────────
-- It is not an archive of the book of business. Zoho CRM is the system of
-- record and the retention system: enrollment documentation lives there for the
-- period CMS requires of agents assisting with Marketplace applications. This
-- is a short-lived replay buffer. Keeping rows beyond that adds PII exposure
-- without adding evidence — see 004.

create table if not exists jot_submissions (
  id            bigserial    primary key,
  created_at    timestamptz  not null default now(),

  agent_id      uuid         not null references agents (id),
  draft_id      uuid         references drafts (id) on delete set null,

  -- The deterministic Form ID this app minted (AP-<hash>). Zoho's `Name` is
  -- unique on JOTS, so this doubles as the idempotency key: a replayed submit
  -- produces the same value and Zoho refuses it as DUPLICATE_DATA. Unique here
  -- too, so a retry reconciles against one row rather than creating a second.
  form_id       text         not null,

  -- Denormalised for querying and for reconciling against the CRM by eye.
  -- Everything else stays in payload so a change to the capture field set does
  -- not need a migration.
  client_name   text,
  requested_effective date,
  carrier       text,

  -- The allowlisted payload as sent, WITH SSNs REDACTED.
  --
  -- This is the deliberate difference from a naive backup. A full copy would
  -- reproduce the SSN of every applicant and every dependent in a second
  -- system, which is a larger standing liability than the recovery it buys —
  -- and the SSN is precisely the field that can be re-collected from the client
  -- in the rare case a replay is needed. IM-Website's buffer keeps only SSN
  -- last-four for the same reason.
  payload       jsonb        not null,

  -- Outcome of the CRM write.
  zoho_status   text         not null default 'pending'
                 check (zoho_status in ('pending', 'success', 'rejected', 'error', 'duplicate')),
  zoho_id       text,
  -- Zoho names the offending field in details.api_name on a rejection, which is
  -- the one part worth keeping: it turns "the CRM said no" into "Home_State was
  -- not on the picklist".
  zoho_error    text,
  settled_at    timestamptz,

  -- Captured server-side from the request, never from the client. Same
  -- reasoning as IM-Website/db/002: an IP the browser supplies is worth nothing
  -- as evidence, and these are personal data that inherit 004's retention.
  client_ip     text,
  user_agent    text
);

-- One row per submission attempt-set. A retry updates rather than inserts.
create unique index if not exists jot_submissions_form_id_key
  on jot_submissions (form_id);

-- "What has this agent filed", newest first.
create index if not exists jot_submissions_agent_idx
  on jot_submissions (agent_id, created_at desc);

-- The reconciliation query: what never reached the CRM. This is the whole
-- reason the table exists, so it gets its own index.
create index if not exists jot_submissions_unsettled_idx
  on jot_submissions (created_at desc)
  where zoho_status <> 'success';

comment on table jot_submissions is
  'Transient replay buffer for agent-portal enrollment submissions. Zoho CRM is the system of record. SSNs are redacted from payload by design. Purge settled rows per 004; never purge unsettled ones without reconciling first.';

-- Retention.
--
-- Zoho CRM is the system of record and the retention system. Enrollment
-- documentation lives there for the full period CMS requires of agents
-- assisting with Marketplace applications. Nothing in this database is an
-- archive, and treating any of it as one would mean holding client PII —
-- including SSNs — in a second system with no reason to.
--
-- This mirrors IM-Website/db/003_retention_policy.sql deliberately. Same
-- reasoning, same rule: the rows that are safe to drop are the ones the CRM
-- already has.

-- ── Submissions ───────────────────────────────────────────────────────────
-- Safe to run on a schedule: only removes what the CRM confirmed.
--
--   delete from jot_submissions
--    where zoho_status = 'success'
--      and settled_at < now() - interval '30 days';
--
-- NEVER blanket-delete on created_at alone. That would take unsettled rows,
-- which are precisely the applications that never reached the CRM — the whole
-- point of the table. Reconcile them first:
--
--   select id, created_at, agent_id, form_id, client_name,
--          zoho_status, zoho_error
--     from jot_submissions
--    where zoho_status <> 'success'
--    order by created_at desc;

-- ── Drafts ────────────────────────────────────────────────────────────────
-- Different rule, because a draft has NO system of record behind it. An expired
-- draft is unsubmitted PII that nobody is coming back for, so it goes on time
-- alone — this is the one table where a blanket delete is correct.
--
--   delete from drafts
--    where submitted_at is null
--      and expires_at < now();
--
-- Submitted drafts are kept briefly so a retry can find them, then dropped:
--
--   delete from drafts
--    where submitted_at is not null
--      and submitted_at < now() - interval '7 days';

-- ── Sessions ──────────────────────────────────────────────────────────────
-- Expired and revoked sessions are kept a short while as an access record, then
-- dropped. They carry IP and user agent, which are personal data in their own
-- right.
--
--   delete from agent_sessions
--    where coalesce(revoked_at, expires_at) < now() - interval '90 days';

-- ── Invitations ───────────────────────────────────────────────────────────
--   delete from agent_invitations
--    where coalesce(consumed_at, expires_at) < now() - interval '90 days';

comment on table drafts is
  'Unsubmitted applications, server-side so they survive bad connectivity. Carries SSNs (encrypted in ssn_cipher) and has no system of record behind it, so it expires on time alone — see 004.';

-- A note on where this runs.
--
-- These are commented rather than scheduled because the scheduler is a
-- deployment decision, not a schema one. Vercel Cron calling an authenticated
-- route is the option that matches how the rest of this stack is deployed;
-- pg_cron works too if the Postgres has it enabled. What matters is that
-- SOMETHING runs them: a retention policy nobody executes is a comment, and the
-- drafts table in particular accumulates SSNs until it does.

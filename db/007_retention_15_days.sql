-- Retention: fifteen days, enforced.
--
-- 004 wrote the purge as comments and warned that "a retention policy nobody
-- executes is a comment". It was. Nothing in vercel.json ran either delete, so
-- settled submissions — names, dates of birth, income, last-four, IPs, user
-- agents — accumulated indefinitely. This file makes the policy concrete at
-- FIFTEEN days for both tables (the office's number; 004 suggested 30 and 7),
-- and /api/cron/retention runs it nightly. The statements live in
-- lib/retention.ts; the number lives in lib/retentionPolicy.ts and is tested.

-- Open drafts expire fifteen days after their LAST save, not their creation —
-- lib/drafts.ts refreshes expires_at on every write, and this default covers a
-- row inserted without one.
alter table drafts alter column expires_at set default now() + interval '15 days';

-- ssn_cipher holds encryptSecret()'s output, a versioned base64url STRING, not
-- raw bytes. Text is the honest type. Guarded so re-running this file against a
-- database that already has text is a no-op. The table has been empty
-- everywhere this schema is deployed, so the USING clause is a formality.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_name = 'drafts'
       and column_name = 'ssn_cipher'
       and data_type = 'bytea'
  ) then
    alter table drafts alter column ssn_cipher type text using encode(ssn_cipher, 'escape');
  end if;
end $$;

-- Drives the settled-row purge. Partial, so unsettled rows are never candidates.
create index if not exists jot_submissions_settled_purge_idx
  on jot_submissions (settled_at)
  where zoho_status = 'success';

-- Drives the submitted-draft purge.
create index if not exists drafts_submitted_purge_idx
  on drafts (submitted_at)
  where submitted_at is not null;

comment on table jot_submissions is
  'Transient replay buffer for agent-portal enrollment submissions. Zoho CRM is the system of record. SSNs are redacted from payload by design. Settled rows are purged 15 days after settled_at by /api/cron/retention. Unsettled rows are never purged automatically: reconcile them first.';

comment on table drafts is
  'Server-side mirror of in-progress applications, so a draft survives a dropped connection and its SSNs are not only in a browser. SSNs live in ssn_cipher (AES-256-GCM under APP_ENCRYPTION_KEY), apart from payload, and are never returned to the browser: they are merged in server-side at submit. Open drafts expire 15 days after the last save. Submitted drafts are purged 15 days after submitted_at. Both by /api/cron/retention.';

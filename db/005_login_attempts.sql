-- Login throttling.
--
-- In Postgres rather than in memory, because the app runs on serverless
-- functions: an in-process counter is per-instance, and an attacker gets a
-- fresh allowance every time the platform starts a new one. A durable counter
-- is the only kind that actually throttles here.
--
-- Two keys are tracked independently, because they defend against different
-- things:
--
--   * by email — someone guessing one agent's password.
--   * by IP     — someone spraying one common password across many agents,
--                 which never trips a per-email limit.
--
-- Failures are recorded, successes clear the email's failures. Rows are
-- deliberately coarse: this is a rate limiter, not an access log — the access
-- record is agent_sessions.

create table if not exists login_attempts (
  id          bigserial    primary key,
  attempted_at timestamptz not null default now(),

  -- Lowercased. Stored even for emails that do not exist, so enumeration
  -- attempts are throttled the same as real ones.
  email       text         not null,

  -- From the request, server-side. Nullable: a proxy may not give us one, and
  -- a missing IP must not prevent recording the attempt.
  client_ip   text,

  -- Only failures are inserted. A success deletes the email's rows instead of
  -- adding a row, so the table stays small and a legitimate agent who mistypes
  -- twice then succeeds is not left near a limit.
  reason      text         not null
              check (reason in ('no_such_agent', 'bad_password', 'inactive', 'locked'))
);

create index if not exists login_attempts_email_idx
  on login_attempts (email, attempted_at desc);

create index if not exists login_attempts_ip_idx
  on login_attempts (client_ip, attempted_at desc)
  where client_ip is not null;

comment on table login_attempts is
  'Durable login throttle. Must be in the database, not in process memory: on serverless, an in-memory counter resets with every new instance and throttles nobody.';

-- ── Retention ──────────────────────────────────────────────────────────────
-- Nothing here is evidence, and it holds an email plus an IP, both personal
-- data. Anything older than the longest lockout window is dead weight.
--
--   delete from login_attempts where attempted_at < now() - interval '7 days';

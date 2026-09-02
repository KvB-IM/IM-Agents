-- The Zoho service connection, held in the database rather than an env var.
--
-- Why not just ZOHO_REFRESH_TOKEN in the environment: because re-authorising
-- then needs a redeploy. Zoho refresh tokens do get revoked — someone removes
-- the client, a scope changes, an admin tidies up connected apps — and when
-- that happens at 9pm during open enrollment, the fix should be an admin
-- clicking "Reconnect" rather than an engineer editing environment variables
-- and waiting for a build.
--
-- There is deliberately no environment-variable path for the token: one source
-- of truth, and a live CRM then requires DATABASE_URL, which makes a stubbed
-- identity reading real client data impossible rather than merely guarded
-- against. See lib/zohoToken.ts.
--
-- One row, ever. Enforced by a primary key on a constant.

create table if not exists zoho_connection (
  id            boolean      primary key default true check (id),

  -- AES-256-GCM, keyed by APP_ENCRYPTION_KEY. A refresh token is a
  -- non-expiring credential to the whole CRM, so it is not sitting here in
  -- plaintext where a database dump or a stray log line would carry it.
  refresh_token_cipher text  not null,

  -- What the grant actually covers, as Zoho returned it. Worth recording:
  -- a connection that works for reads and 401s on create is almost always a
  -- missing scope, and this is how you find that out without guessing.
  scopes        text,

  -- Which Zoho API domain this grant belongs to. Zoho returns it on the token
  -- exchange and it is NOT always the one you asked for — a .eu org hands back
  -- a .eu domain, and using the wrong one fails with an opaque error.
  api_domain    text,

  connected_at  timestamptz  not null default now(),
  -- The agent who authorised it, for the "who connected this" question.
  connected_by  uuid         references agents (id) on delete set null,

  -- Last successful token refresh, so a dead connection is visible before an
  -- agent reports it.
  last_refresh_at timestamptz,
  last_error      text,
  last_error_at   timestamptz
);

comment on table zoho_connection is
  'The single Zoho service connection. One row. Refresh token encrypted with APP_ENCRYPTION_KEY. Written by the OAuth callback; there is no environment-variable path.';

-- ── OAuth state ────────────────────────────────────────────────────────────
-- CSRF protection for the authorisation redirect.
--
-- Without it, an attacker can send an admin a crafted callback URL carrying a
-- code from the attacker's own Zoho org, and the app would happily store it —
-- pointing the whole portal at a CRM the attacker controls. Short-lived,
-- single-use, and tied to the agent who started the flow.

create table if not exists oauth_states (
  state       text         primary key,
  created_at  timestamptz  not null default now(),
  expires_at  timestamptz  not null default now() + interval '15 minutes',
  consumed_at timestamptz,
  agent_id    uuid         references agents (id) on delete cascade,
  -- Where to send the admin afterwards.
  return_to   text
);

create index if not exists oauth_states_expiry_idx
  on oauth_states (expires_at)
  where consumed_at is null;

-- ── Admin flag ─────────────────────────────────────────────────────────────
-- Connecting the CRM is not a field-agent action. Until there is a fuller role
-- model, one boolean is enough and is honest about what it is.

alter table agents
  add column if not exists is_admin boolean not null default false;

comment on column agents.is_admin is
  'May connect/reconnect the Zoho service connection and administer accounts. Not a field-agent capability.';

-- ── Retention ──────────────────────────────────────────────────────────────
--   delete from oauth_states
--    where coalesce(consumed_at, expires_at) < now() - interval '1 day';

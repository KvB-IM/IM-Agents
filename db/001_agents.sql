-- Field agent accounts.
--
-- This app reaches Zoho through ONE service connection, because field agents
-- have no Zoho accounts and never will. So Zoho enforces nothing about who may
-- see what, and this table is the identity half of the permission layer that
-- replaces it. See SOFTWARE_SCOPE.md section 7.
--
-- Admin-invited only. There is deliberately no self-service registration: an
-- account here is a key to client PII including SSNs.

create table if not exists agents (
  id             uuid         primary key default gen_random_uuid(),
  created_at     timestamptz  not null default now(),
  updated_at     timestamptz  not null default now(),

  email          text         not null,

  -- MUST match this agent's entry in Zoho's `Agent` global picklist
  -- (id 5102272000006932237) exactly.
  --
  -- Submitting_Field_Agent is a picklist backed by that global set — not a user
  -- lookup and not free text — so Zoho SILENTLY DROPS a value that is not on
  -- it. An agent whose name is missing or misspelt here files forms attributed
  -- to nobody, and then reads back an empty submissions list that looks like a new
  -- account rather than a broken one. GET /api/health checks for exactly this.
  --
  -- Consequence for the admin flow: onboarding an agent is a Zoho picklist
  -- change as well as a row here.
  zoho_agent_name text        not null,

  agency         text         not null default 'Insurance Masters',

  -- Upline, written onto the Jot alongside the field agent. Both are picklists
  -- in Zoho with the same silent-drop behaviour as above.
  sub_agent          text,
  regional_manager   text,

  -- invited -> active -> inactive. An inactive agent cannot sign in and their
  -- sessions are revoked; their submitted forms stay in the CRM untouched.
  status         text         not null default 'invited'
                 check (status in ('invited', 'active', 'inactive')),

  -- Argon2id or scrypt. Never SHA-anything: the ICHRA system used unsalted
  -- SHA-256 and that is an explicit anti-requirement (scope 4.1).
  password_hash  text,

  -- Expected at launch for a role carrying SSNs on a mobile device.
  mfa_secret     text,
  mfa_enrolled_at timestamptz,

  last_login_at  timestamptz
);

-- One account per email. Case-insensitive, because an agent typing
-- "Dana@..." on an iPad must not create a second identity.
create unique index if not exists agents_email_key
  on agents (lower(email));

-- The submissions query filters on this name, so it has to resolve to one agent.
create unique index if not exists agents_zoho_agent_name_key
  on agents (lower(zoho_agent_name));

-- ── Invitations ────────────────────────────────────────────────────────────
-- A token link, short-lived, single-use. Separate from the agent row so an
-- invitation can be reissued without touching the account, and so a consumed
-- token leaves an auditable record.

create table if not exists agent_invitations (
  id          uuid         primary key default gen_random_uuid(),
  agent_id    uuid         not null references agents (id) on delete cascade,
  created_at  timestamptz  not null default now(),

  -- The token is stored HASHED. A leaked database must not hand over working
  -- invitation links.
  token_hash  text         not null,
  expires_at  timestamptz  not null,
  consumed_at timestamptz,
  created_by  text
);

create unique index if not exists agent_invitations_token_key
  on agent_invitations (token_hash);

create index if not exists agent_invitations_agent_idx
  on agent_invitations (agent_id, created_at desc);

-- ── Sessions ───────────────────────────────────────────────────────────────
-- Server-side and revocable, which is the whole reason this is a table rather
-- than a self-contained JWT.
--
-- An iPad gets lost. Deactivating an agent has to end their access NOW, and a
-- stateless token cannot be withdrawn. The ICHRA system issued JWTs with no
-- expiry at all; that is an anti-requirement.

create table if not exists agent_sessions (
  id            uuid         primary key default gen_random_uuid(),
  agent_id      uuid         not null references agents (id) on delete cascade,
  created_at    timestamptz  not null default now(),

  -- Hashed, like the invitation token: the cookie holds the secret, the
  -- database holds only a verifier.
  token_hash    text         not null,

  expires_at    timestamptz  not null,
  last_seen_at  timestamptz  not null default now(),
  revoked_at    timestamptz,

  -- Captured server-side from the request, never from the client — an IP the
  -- browser supplies is worth nothing as evidence. Same reasoning as
  -- IM-Website/db/002. These are personal data in their own right and inherit
  -- the retention policy in 004.
  client_ip     text,
  user_agent    text
);

create unique index if not exists agent_sessions_token_key
  on agent_sessions (token_hash);

-- Revoking every session for one agent, which is the action that matters.
create index if not exists agent_sessions_agent_idx
  on agent_sessions (agent_id, revoked_at, expires_at);

comment on table agent_sessions is
  'Server-side sessions. Revocable by design: a lost iPad or a deactivated agent must lose access immediately, which a stateless token cannot deliver.';

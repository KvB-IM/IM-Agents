import "server-only";
import { randomBytes } from "node:crypto";
import { sql, dbConfigured } from "./db";
import { hashPassword } from "./password";
import { revokeAllSessions } from "./auth";

/**
 * Agent administration.
 *
 * Everything here is gated on `agents.is_admin` by the route that calls it —
 * these functions do not check, so do not call them from anywhere that has not
 * established the caller is an admin.
 */

export interface AdminAgentRow {
  id: string;
  email: string;
  zohoAgentName: string;
  agency: string;
  status: string;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
  hasPassword: boolean;
}

/** True when this agent id has the admin flag. The gate every route uses. */
export async function isAdmin(agentId: string): Promise<boolean> {
  if (!dbConfigured()) return false;
  try {
    const db = sql();
    const rows = (await db`
      select is_admin from agents where id = ${agentId} limit 1
    `) as Array<{ is_admin: boolean }>;
    return rows[0]?.is_admin === true;
  } catch {
    // Fail closed. An unreadable database must not grant admin.
    return false;
  }
}

export async function listAgents(): Promise<AdminAgentRow[]> {
  const db = sql();
  const rows = (await db`
    select a.id, a.email, a.zoho_agent_name, a.agency, a.status, a.is_admin,
           a.created_at, a.last_login_at,
           a.password_hash is not null as has_password,
           (select count(*)::int
              from agent_sessions s
             where s.agent_id = a.id
               and s.revoked_at is null
               and s.expires_at > now()) as active_sessions
      from agents a
     order by a.status, lower(a.email)
  `) as Array<{
    id: string;
    email: string;
    zoho_agent_name: string;
    agency: string;
    status: string;
    is_admin: boolean;
    created_at: string;
    last_login_at: string | null;
    has_password: boolean;
    active_sessions: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    zohoAgentName: r.zoho_agent_name,
    agency: r.agency,
    status: r.status,
    isAdmin: r.is_admin,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
    activeSessions: r.active_sessions,
    hasPassword: r.has_password,
  }));
}

/**
 * A password an admin can read out over the phone.
 *
 * Four words from a small, deliberately unambiguous list plus digits. Long
 * enough to resist guessing, and sayable — an admin creating an account is
 * going to communicate it verbally or by text, and a random symbol soup gets
 * mistyped on an iPad until somebody writes it on a sticky note.
 *
 * This is a FIRST password, not a permanent one. The proper answer is the
 * invitation flow the schema already supports (`agent_invitations`), where the
 * agent sets their own and the admin never knows it. That needs email.
 */
const WORDS = [
  "anchor", "basket", "candle", "dolphin", "ember", "falcon", "garden", "harbor",
  "island", "jacket", "kettle", "lantern", "meadow", "nectar", "orchard", "pebble",
  "quarry", "ribbon", "saddle", "timber", "umbrella", "velvet", "willow", "yonder",
];

export function generatePassword(): string {
  const bytes = randomBytes(6);
  const words = Array.from({ length: 4 }, (_, i) => WORDS[bytes[i] % WORDS.length]);
  const digits = String(((bytes[4] << 8) | bytes[5]) % 1000).padStart(3, "0");
  return `${words.join("-")}-${digits}`;
}

export interface CreateAgentInput {
  email: string;
  zohoAgentName: string;
  agency: string;
  isAdmin: boolean;
}

export type CreateResult =
  | { ok: true; id: string; password: string }
  | { ok: false; error: string };

/**
 * Create an agent, or refuse.
 *
 * Deliberately NOT an upsert. The CLI script upserts because it doubles as a
 * password reset, but an admin typing an email that already exists in a UI is
 * making a mistake — silently resetting a colleague's password and revoking
 * their sessions is not what they meant.
 */
export async function createAgent(input: CreateAgentInput): Promise<CreateResult> {
  const email = input.email.trim().toLowerCase();
  const zohoAgentName = input.zohoAgentName.trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
    return { ok: false, error: "That does not look like an email address." };
  }
  if (!zohoAgentName || zohoAgentName.length > 200) {
    return { ok: false, error: "A Zoho agent name is required." };
  }

  const db = sql();
  const existing = (await db`
    select id from agents where lower(email) = ${email} limit 1
  `) as Array<{ id: string }>;
  if (existing.length > 0) {
    return { ok: false, error: "An account with that email already exists." };
  }

  const clash = (await db`
    select email from agents where lower(zoho_agent_name) = ${zohoAgentName.toLowerCase()} limit 1
  `) as Array<{ email: string }>;
  if (clash.length > 0) {
    // The pipeline query filters on this name, so two accounts sharing it would
    // each see the other's clients.
    return {
      ok: false,
      error: `${clash[0].email} already uses the Zoho agent name "${zohoAgentName}". Two accounts cannot share it — they would see each other's clients.`,
    };
  }

  const password = generatePassword();
  const rows = (await db`
    insert into agents (email, zoho_agent_name, agency, status, password_hash, is_admin)
    values (${email}, ${zohoAgentName}, ${input.agency.trim() || "Insurance Masters"},
            'active', ${await hashPassword(password)}, ${input.isAdmin})
    returning id
  `) as Array<{ id: string }>;

  return { ok: true, id: rows[0].id, password };
}

/**
 * Disable an account.
 *
 * Revokes every live session as well as flipping the status. Either alone is
 * insufficient: the status check is in the session query so a disabled agent
 * stops working on their next request, but revoking makes it immediate and
 * leaves an auditable record of when access ended. This is the lost-iPad
 * action.
 */
export async function disableAgent(agentId: string): Promise<number> {
  const db = sql();
  await db`update agents set status = 'inactive', updated_at = now() where id = ${agentId}`;
  return revokeAllSessions(agentId);
}

export async function enableAgent(agentId: string): Promise<void> {
  const db = sql();
  await db`update agents set status = 'active', updated_at = now() where id = ${agentId}`;
}

/**
 * Reset a password and end every session.
 *
 * Sessions go because whoever knew the old password may still be holding one.
 * The throttle is cleared too — an agent who locked themselves out is the
 * commonest reason this is used.
 */
export async function resetPassword(agentId: string): Promise<string> {
  const password = generatePassword();
  const db = sql();
  const rows = (await db`
    update agents
       set password_hash = ${await hashPassword(password)}, updated_at = now()
     where id = ${agentId}
    returning email
  `) as Array<{ email: string }>;

  await revokeAllSessions(agentId);
  if (rows[0]) {
    await db`delete from login_attempts where email = ${rows[0].email.toLowerCase()}`;
  }
  return password;
}

/**
 * Grant or remove admin.
 *
 * The caller must refuse to remove the LAST admin — see the route. Locking
 * everyone out of administration is recoverable only by running the CLI script
 * against the database.
 */
export async function setAdmin(agentId: string, value: boolean): Promise<void> {
  const db = sql();
  await db`update agents set is_admin = ${value}, updated_at = now() where id = ${agentId}`;
}

export async function countAdmins(): Promise<number> {
  const db = sql();
  const rows = (await db`
    select count(*)::int as n from agents where is_admin = true and status = 'active'
  `) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

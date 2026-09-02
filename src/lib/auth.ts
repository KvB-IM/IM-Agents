import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sql } from "./db";
import { verifyPassword, DUMMY_HASH } from "./password";
import type { AgentIdentity } from "./jot";

/**
 * Sessions and login.
 *
 * Server-side and revocable by design (scope §4.1). The cookie carries a random
 * secret; the database stores only a hash of it, so a leaked database yields no
 * working sessions. Deactivating an agent or losing an iPad has to end access
 * immediately, which a self-contained JWT cannot deliver — that is the whole
 * reason agent_sessions is a table.
 */

export { SESSION_COOKIE } from "./cookies";
import { SESSION_COOKIE } from "./cookies";

/* Long enough that an agent is not signing in between house calls, short
 * enough that a forgotten iPad stops working within a shift or two. */
const SESSION_TTL_DAYS = 7;
/* Refresh the row's last_seen at most this often, so ordinary browsing does
 * not write on every request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/* Throttle windows. Per-email catches password guessing; per-IP catches one
 * common password sprayed across many agents, which never trips a per-email
 * limit. */
const EMAIL_MAX_FAILURES = 8;
const EMAIL_WINDOW_MINUTES = 15;
const IP_MAX_FAILURES = 30;
const IP_WINDOW_MINUTES = 15;

/** A session token: 32 random bytes. The cookie value. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a session token for storage.
 *
 * Plain SHA-256, deliberately — unlike a password, this is 256 bits of
 * cryptographic randomness, so there is nothing to guess and no reason to pay
 * for a slow KDF on every single request.
 */
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export interface AgentRow {
  id: string;
  email: string;
  zoho_agent_name: string;
  agency: string;
  sub_agent: string | null;
  regional_manager: string | null;
  status: string;
  password_hash: string | null;
}

export function toIdentity(row: AgentRow): AgentIdentity {
  return {
    id: row.id,
    name: row.zoho_agent_name,
    agency: row.agency,
    subAgent: row.sub_agent ?? undefined,
    regionalManager: row.regional_manager ?? undefined,
  };
}

/* ── Throttling ─────────────────────────────────────────────────────────── */

interface ThrottleState {
  blocked: boolean;
  retryAfterMinutes: number;
}

async function checkThrottle(email: string, clientIp: string | null): Promise<ThrottleState> {
  const db = sql();
  const rows = (await db`
    select
      count(*) filter (
        where email = ${email}
          and attempted_at > now() - (${EMAIL_WINDOW_MINUTES} || ' minutes')::interval
      ) as email_failures,
      count(*) filter (
        where client_ip is not null and client_ip = ${clientIp}
          and attempted_at > now() - (${IP_WINDOW_MINUTES} || ' minutes')::interval
      ) as ip_failures
    from login_attempts
  `) as Array<{ email_failures: string; ip_failures: string }>;

  const emailFailures = Number(rows[0]?.email_failures ?? 0);
  const ipFailures = Number(rows[0]?.ip_failures ?? 0);

  if (emailFailures >= EMAIL_MAX_FAILURES) {
    return { blocked: true, retryAfterMinutes: EMAIL_WINDOW_MINUTES };
  }
  if (clientIp && ipFailures >= IP_MAX_FAILURES) {
    return { blocked: true, retryAfterMinutes: IP_WINDOW_MINUTES };
  }
  return { blocked: false, retryAfterMinutes: 0 };
}

async function recordFailure(
  email: string,
  clientIp: string | null,
  reason: "no_such_agent" | "bad_password" | "inactive" | "locked",
): Promise<void> {
  const db = sql();
  await db`
    insert into login_attempts (email, client_ip, reason)
    values (${email}, ${clientIp}, ${reason})
  `;
}

async function clearFailures(email: string): Promise<void> {
  const db = sql();
  await db`delete from login_attempts where email = ${email}`;
}

/* ── Login ──────────────────────────────────────────────────────────────── */

export type LoginResult =
  | { ok: true; agent: AgentIdentity; token: string; expiresAt: Date }
  | { ok: false; message: string; retryAfterMinutes?: number };

/**
 * Verify a credential and open a session.
 *
 * Every failure returns the SAME message. Distinguishing "no such account" from
 * "wrong password" hands an attacker a free account-enumeration oracle, and an
 * agent who cannot sign in needs to call the office either way — the precise
 * reason is in login_attempts for whoever looks.
 */
export async function login(
  emailRaw: string,
  password: string,
  clientIp: string | null,
  userAgent: string | null,
): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  const GENERIC = "That email and password do not match an active account.";

  if (!email || !password) return { ok: false, message: GENERIC };

  const throttle = await checkThrottle(email, clientIp);
  if (throttle.blocked) {
    await recordFailure(email, clientIp, "locked");
    return {
      ok: false,
      message: `Too many attempts. Try again in ${throttle.retryAfterMinutes} minutes, or call the office.`,
      retryAfterMinutes: throttle.retryAfterMinutes,
    };
  }

  const db = sql();
  const rows = (await db`
    select id, email, zoho_agent_name, agency, sub_agent, regional_manager,
           status, password_hash
      from agents
     where lower(email) = ${email}
     limit 1
  `) as AgentRow[];

  const agent = rows[0];

  // No account, or an account with no password set (invited but never
  // completed). Still run a verify against the dummy hash so this path costs
  // the same as a real one — an instant return here is a timing oracle for
  // which emails exist.
  if (!agent || !agent.password_hash) {
    await verifyPassword(password, DUMMY_HASH);
    await recordFailure(email, clientIp, "no_such_agent");
    return { ok: false, message: GENERIC };
  }

  const passwordOk = await verifyPassword(password, agent.password_hash);
  if (!passwordOk) {
    await recordFailure(email, clientIp, "bad_password");
    return { ok: false, message: GENERIC };
  }

  // Checked after the password, on purpose: telling an attacker "that account
  // exists but is inactive" before they prove the password is the same
  // enumeration leak in a different coat.
  if (agent.status !== "active") {
    await recordFailure(email, clientIp, "inactive");
    return { ok: false, message: GENERIC };
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await db`
    insert into agent_sessions (agent_id, token_hash, expires_at, client_ip, user_agent)
    values (${agent.id}, ${tokenHash(token)}, ${expiresAt.toISOString()},
            ${clientIp}, ${userAgent})
  `;
  await db`update agents set last_login_at = now(), updated_at = now() where id = ${agent.id}`;
  await clearFailures(email);

  return { ok: true, agent: toIdentity(agent), token, expiresAt };
}

/* ── Reading the session ────────────────────────────────────────────────── */

/**
 * The agent for the current request, or null.
 *
 * One query joining the session to the agent, so a deactivated agent's live
 * session stops working immediately rather than at expiry — `status = 'active'`
 * is in the WHERE clause, not checked afterwards.
 */
export async function agentFromSession(): Promise<AgentIdentity | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return await lookupSession(token);
  } catch (err) {
    // A database outage must fail CLOSED. Returning null means "not signed in",
    // which sends the agent to the login screen — annoying but safe. Letting it
    // throw would surface a stack trace on every protected page, and treating
    // an error as "signed in" would be an authentication bypass triggered by
    // taking the database down.
    console.error("[auth] session lookup failed:", err);
    return null;
  }
}

async function lookupSession(token: string): Promise<AgentIdentity | null> {
  const db = sql();
  const rows = (await db`
    select a.id, a.email, a.zoho_agent_name, a.agency, a.sub_agent,
           a.regional_manager, a.status, a.password_hash,
           s.id as session_id, s.last_seen_at
      from agent_sessions s
      join agents a on a.id = s.agent_id
     where s.token_hash = ${tokenHash(token)}
       and s.revoked_at is null
       and s.expires_at > now()
       and a.status = 'active'
     limit 1
  `) as Array<AgentRow & { session_id: string; last_seen_at: string }>;

  const row = rows[0];
  if (!row) return null;

  // Touch sparingly. Writing on every request would put a database write in
  // front of every page render for a value nobody reads to the minute.
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (Date.now() - lastSeen > TOUCH_INTERVAL_MS) {
    await db`update agent_sessions set last_seen_at = now() where id = ${row.session_id}`;
  }

  return toIdentity(row);
}

/** End the current session. */
export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;

  try {
    const db = sql();
    await db`
      update agent_sessions set revoked_at = now()
       where token_hash = ${tokenHash(token)} and revoked_at is null
    `;
  } catch (err) {
    // Never block a sign-out on the database. The caller clears the cookie
    // regardless, so the browser stops presenting it; the row is left live,
    // which is why revoking on the server is best-effort here and the real
    // guarantee is the expiry plus revokeAllSessions.
    console.error("[auth] logout could not revoke the session row:", err);
  }
}

/** Revoke every session for one agent — the lost-iPad action. */
export async function revokeAllSessions(agentId: string): Promise<number> {
  const db = sql();
  const rows = (await db`
    update agent_sessions set revoked_at = now()
     where agent_id = ${agentId} and revoked_at is null
     returning id
  `) as Array<{ id: string }>;
  return rows.length;
}

/* ── Cookie ─────────────────────────────────────────────────────────────── */

/**
 * Cookie attributes.
 *
 * httpOnly so script cannot read it; sameSite lax so a link from an email or a
 * text still lands the agent signed in, while a cross-site POST cannot ride the
 * session. Secure everywhere except local http development.
 */
export function sessionCookie(token: string, expiresAt: Date) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

export function clearedSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

/**
 * The client IP, taken from the platform's header rather than anything the
 * browser can set.
 *
 * Same reasoning as IM-Website/db/002: an IP the client supplies is worth
 * nothing. `x-forwarded-for` is appended to by each proxy, and only the LAST
 * entry is added by infrastructure we control — an attacker can prepend
 * whatever they like, so reading the first entry would let them rotate through
 * fake IPs and defeat the per-IP throttle entirely.
 */
export function clientIpFrom(headers: Headers): string | null {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded) return null;
  const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/** Constant-time string compare, for anything secret that is not a password. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

import "server-only";
import { redirect } from "next/navigation";
import type { AgentIdentity } from "./jot";

import { dbConfigured } from "./db";
import { agentFromSession } from "./auth";

/**
 * Who is making this request.
 *
 * Two modes, and the choice is made by configuration rather than by a flag
 * anyone can flip:
 *
 *   * DATABASE_URL set — real accounts. The session cookie is looked up in
 *     agent_sessions, joined to an active agent. No session means no identity.
 *
 *   * DATABASE_URL absent — one stubbed agent, so the UI can be built and
 *     demoed with nothing but `npm run dev`. Allowed ONLY with fixture data;
 *     see assertSafeToServe.
 */

/**
 * The combination that must never ship.
 *
 * With one Zoho service connection, this app is the only thing deciding who
 * sees which client. A stubbed session means there is no such decision — every
 * visitor is the same agent. Locally that is a convenience. On a deployed URL,
 * with real credentials, it publishes that agent's entire pipeline (names,
 * dates of birth, addresses, enrollment history) to anyone who finds the link.
 *
 * Kept even now that real auth exists, because the stub is still reachable: all
 * it takes is a deploy where DATABASE_URL was forgotten but the Zoho variables
 * were not. That is a plausible mistake, and this turns it into a loud failure
 * instead of a silent disclosure.
 */
function assertSafeToServe(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (dbConfigured()) return;
  /* With no database, the ONLY way the CRM can be live is a refresh token in
   * the environment — a token stored in zoho_connection needs the database
   * this branch has already established is absent. So the dangerous
   * combination is fully described by these env vars, and this check stays
   * synchronous rather than dragging a database round trip into every render. */
  const liveViaEnv = Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN,
  );
  if (!liveViaEnv) return;
  if (process.env.ALLOW_STUBBED_AUTH_WITH_LIVE_CRM === "i-understand-this-is-unauthenticated") {
    return;
  }

  throw new Error(
    "Refusing to serve live CRM data with a stubbed session in production. " +
      "This build has Zoho credentials but no DATABASE_URL, so there are no " +
      "accounts and every visitor would be treated as the same field agent — " +
      "able to read that agent's whole pipeline. Set DATABASE_URL and apply " +
      "db/*.sql, or — only if this deployment is already access-gated — set " +
      "ALLOW_STUBBED_AUTH_WITH_LIVE_CRM=i-understand-this-is-unauthenticated.",
  );
}

/** The stubbed identity, used only in fixture mode. */
function stubAgent(): AgentIdentity {
  return {
    id: "agent-001",
    // Must exist in Zoho's `Agent` global picklist for a write to succeed.
    name: process.env.PROTOTYPE_AGENT_NAME || "Dana Ruiz",
    agency: "Insurance Masters",
  };
}

/**
 * The current agent, or null when nobody is signed in.
 *
 * Use this where a missing session is a normal outcome. Everything that renders
 * an agent's own data should use `requireAgent` instead.
 */
export async function currentAgentOrNull(): Promise<AgentIdentity | null> {
  assertSafeToServe();
  if (!dbConfigured()) return stubAgent();
  return agentFromSession();
}

/**
 * The current agent, or a redirect to sign-in.
 *
 * This is the function every protected page and route uses. The middleware
 * bounces unauthenticated requests before they get here, but that is a
 * convenience for the browser and NOT the boundary: middleware runs on paths,
 * and a path it does not match would sail straight through. The real check is
 * this call, in the code that touches the data.
 */
export async function requireAgent(nextPath?: string): Promise<AgentIdentity> {
  const agent = await currentAgentOrNull();
  if (agent) return agent;

  const target = nextPath && nextPath.startsWith("/") ? nextPath : "/quote";
  redirect(`/login?next=${encodeURIComponent(target)}`);
}

/**
 * @deprecated Use `requireAgent` in pages and `currentAgentOrNull` where a
 * missing session is expected. Kept so the API routes read the same as before
 * while they are migrated one at a time.
 */
export async function currentAgent(): Promise<AgentIdentity> {
  return requireAgent();
}

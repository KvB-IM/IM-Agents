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
 *     demoed with nothing but `npm run dev`. Safe because a live CRM requires
 *     DATABASE_URL, so this branch can only ever serve fixture data — see the
 *     invariant note below.
 */

/*
 * A note on the combination that used to need guarding.
 *
 * A stubbed session means every visitor is the same agent. Paired with live CRM
 * credentials on a public URL, that would publish one agent's whole submissions list —
 * names, dates of birth, addresses — to anyone with the link. There was a
 * runtime check here that threw on exactly that.
 *
 * It is gone because the combination is now impossible rather than merely
 * detected. The Zoho refresh token lives only in the database (lib/zohoToken.ts
 * — there is no environment-variable path), so a live CRM requires
 * DATABASE_URL. The stub below runs only when DATABASE_URL is absent. The two
 * cannot co-occur.
 *
 * That is a load-bearing invariant, not a coincidence. If an env-var token path
 * is ever reintroduced, this guard has to come back with it.
 */

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

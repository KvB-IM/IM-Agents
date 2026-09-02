import "server-only";
import type { AgentIdentity } from "./jot";
import { zohoConfigured } from "./zoho";

/**
 * PROTOTYPE IDENTITY.
 *
 * Real identity is SOFTWARE_SCOPE.md section 4.1: app-native accounts, invited
 * by an admin, with server-side revocable sessions and MFA. The schema is in
 * db/001_agents.sql; nothing is wired to it yet.
 *
 * That is deliberately NOT stubbed cleverly here — a fake login screen is the
 * ICHRA system's "UI-only password reset" mistake in a new costume. This
 * returns one fixed agent so the rest of the app can be built against the real
 * shape: everything downstream takes an AgentIdentity and none of it cares
 * where the identity came from.
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
 * So the two are made mutually exclusive, loudly, rather than left to a
 * deployment checklist. Deploying today serves fixture data and is harmless.
 * Adding Zoho credentials later WITHOUT having built auth first fails the app
 * outright, which is the correct outcome: the fix is to finish section 4.1, not
 * to remove this check.
 *
 * Mirrors the reasoning in IM_CRM_Frontend, whose fixture mode "can never
 * engage when NODE_ENV=production" — same instinct, opposite direction,
 * because here it is the live data that is dangerous rather than the fake.
 */
function assertSafeToServe(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!zohoConfigured()) return;
  // An explicit, deliberate override for a protected staging deployment where
  // the URL is already gated (Vercel deployment protection, a VPN, basic auth).
  // Named so that setting it is a conscious act with an obvious meaning.
  if (process.env.ALLOW_STUBBED_AUTH_WITH_LIVE_CRM === "i-understand-this-is-unauthenticated") {
    return;
  }

  throw new Error(
    "Refusing to serve live CRM data with a stubbed session in production. " +
      "This build has Zoho credentials but no real authentication, so every " +
      "visitor would be treated as the same field agent and could read that " +
      "agent's whole pipeline. Finish app-native auth (SOFTWARE_SCOPE.md 4.1, " +
      "schema in db/001_agents.sql), or — only if this deployment is already " +
      "access-gated — set " +
      "ALLOW_STUBBED_AUTH_WITH_LIVE_CRM=i-understand-this-is-unauthenticated.",
  );
}

export async function currentAgent(): Promise<AgentIdentity> {
  assertSafeToServe();

  return {
    id: "agent-001",
    // Must exist in Zoho's `Agent` global picklist for a write to succeed.
    name: process.env.PROTOTYPE_AGENT_NAME || "Dana Ruiz",
    agency: "Insurance Masters",
  };
}

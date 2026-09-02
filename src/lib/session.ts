import "server-only";
import type { AgentIdentity } from "./jot";

/**
 * PROTOTYPE ONLY.
 *
 * Real identity is SOFTWARE_SCOPE.md section 4.1: app-native accounts, invited
 * by an admin, with server-side revocable sessions and MFA. That is deliberately
 * NOT stubbed cleverly here — a fake login screen is the ICHRA system's
 * "UI-only password reset" mistake in a new costume.
 *
 * This returns one fixed agent so the rest of the app can be built against the
 * real shape: everything downstream takes an AgentIdentity and none of it cares
 * where the identity came from.
 */
export async function currentAgent(): Promise<AgentIdentity> {
  return {
    id: "agent-001",
    // Must exist in Zoho's `Agent` global picklist for a write to succeed.
    name: process.env.PROTOTYPE_AGENT_NAME || "Dana Ruiz",
    agency: "Insurance Masters",
    regionalManager: "Ellis Barrow",
  };
}

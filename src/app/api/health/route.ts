import { NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { listJots, usingLiveCrm } from "@/lib/store";
import { hsConfigured } from "@/lib/healthsherpa";
import { dbConfigured, databaseUrlSource } from "@/lib/db";
import { isUpstreamError, zohoClientConfigured } from "@/lib/zoho";
import { encryptionConfigured } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — does each upstream actually work, as configured right now?
 *
 * Written because the failure modes that matter here are all silent:
 *
 *   * A missing Zoho credential falls back to fixtures, which looks like a
 *     working app showing invented forms.
 *   * An agent whose name is absent from Zoho's `Agent` global picklist reads
 *     back zero forms, which looks like a new agent rather than a broken one.
 *   * A revoked refresh token only surfaces on the next CRM call.
 *
 * So this reports what is configured, what a real scoped read returns, and the
 * likely cause when the answer is "nothing".
 *
 * Deliberately reachable without a session: this is the endpoint you hit when a
 * deployment misbehaves, and needing to log in to discover that logins are
 * broken is not useful. It exposes no client data.
 */
export async function GET() {
  const liveCrm = await usingLiveCrm();

  const upstreams = {
    healthSherpa: hsConfigured()
      ? { configured: true, mode: "live" }
      : { configured: false, mode: "fixture", note: "Quoting returns fixture plans." },
    crm: liveCrm
      ? { configured: true, mode: "live" }
      : {
          configured: false,
          mode: "fixture",
          note: "Pipeline and KPIs are fixture data.",
          // Which piece is missing, since "not connected" has three causes and
          // guessing between them is the slow way to fix a deployment.
          clientCredentials: zohoClientConfigured(),
          database: dbConfigured(),
          encryptionKey: encryptionConfigured(),
          hint: zohoClientConfigured()
            ? "Client credentials are set. An admin can now connect the CRM from their profile."
            : "Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET, then connect from an admin profile.",
        },
    auth: dbConfigured()
      ? { mode: "accounts", connectionFrom: databaseUrlSource() }
      : {
          mode: "stubbed",
          note: "No database connection string — every visitor is the same agent.",
          accepted: "DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL",
        },
  };

  const agent = await currentAgentOrNull();
  if (!agent) {
    return NextResponse.json({ ...upstreams, signedIn: false });
  }

  const scope = AgentScope.forAgent(agent.id, agent.name);
  const checks: Record<string, unknown> = {
    ...upstreams,
    signedIn: true,
    agent: { name: agent.name, agency: agent.agency },
  };

  try {
    const jots = await listJots(scope);
    checks.read = {
      ok: true,
      formsVisible: jots.length,
      ...(liveCrm && jots.length === 0
        ? {
            warning:
              `The CRM returned no forms for "${agent.name}". If that is unexpected, check ` +
              `that this exact name exists in Zoho's Agent global picklist — ` +
              `Submitting_Field_Agent silently drops values that are not on it.`,
          }
        : {}),
    };
  } catch (err) {
    checks.read = isUpstreamError(err)
      ? { ok: false, status: err.status, error: err.userMessage, detail: err.message }
      : { ok: false, error: String(err) };
  }

  const ok = (checks.read as { ok?: boolean }).ok === true;
  return NextResponse.json(checks, { status: ok ? 200 : 503 });
}

import { NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { listJots, usingLiveCrm } from "@/lib/store";
import { hsConfigured } from "@/lib/healthsherpa";
import { dbConfigured } from "@/lib/db";
import { isUpstreamError } from "@/lib/zoho";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — does each upstream actually work, as configured right now?
 *
 * Written because the two failure modes that matter here are both silent. A
 * missing Zoho credential falls back to fixtures, which looks like a working
 * app showing invented forms. And an agent whose name is absent from Zoho's
 * `Agent` global picklist reads back zero forms, which looks like a new agent
 * rather than a broken one.
 *
 * So this reports what is configured AND what a real scoped read returns, and
 * it names the picklist as the likely cause of an empty result.
 */
export async function GET() {
  const agent = await currentAgentOrNull();
  if (!agent) {
    // Reachable without a session on purpose: this is the endpoint you hit when
    // a deployment misbehaves, and requiring a login to find out that logins
    // are broken is not useful. It exposes no client data.
    return NextResponse.json({
      auth: dbConfigured() ? "accounts configured; not signed in" : "no database; identity stubbed",
      healthSherpa: hsConfigured() ? "live" : "fixture",
      crm: usingLiveCrm() ? "live" : "fixture",
    });
  }
  const scope = AgentScope.forAgent(agent.id, agent.name);

  const checks: Record<string, unknown> = {
    healthSherpa: hsConfigured()
      ? { configured: true, mode: "live" }
      : { configured: false, mode: "fixture", note: "Quoting returns fixture plans." },
    crm: usingLiveCrm()
      ? { configured: true, mode: "live" }
      : { configured: false, mode: "fixture", note: "Pipeline and KPIs are fixture data." },
    auth: dbConfigured() ? { mode: "accounts" } : { mode: "stubbed", note: "No DATABASE_URL." },
    agent: { name: agent.name, agency: agent.agency },
  };

  try {
    const jots = await listJots(scope);
    checks.read = {
      ok: true,
      formsVisible: jots.length,
      ...(usingLiveCrm() && jots.length === 0
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

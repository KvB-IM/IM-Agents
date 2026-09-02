import { NextResponse } from "next/server";
import { currentAgent } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { listJots } from "@/lib/store";
import { computeKpis } from "@/lib/kpis";

/**
 * GET /api/kpis → this agent's production.
 *
 * Note there is no agent parameter. The numbers are computed from a list that
 * was already scope-filtered, so there is nothing to tamper with.
 */
export async function GET() {
  const agent = await currentAgent();
  const scope = AgentScope.forAgent(agent.id, agent.name);
  const jots = await listJots(scope);
  return NextResponse.json({ kpis: computeKpis(jots), agent: { name: agent.name, agency: agent.agency } });
}

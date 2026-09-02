import { NextResponse } from "next/server";
import { currentAgent } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { getJot, applyCorrections, allowedCorrections } from "@/lib/store";
import { isUpstreamError } from "@/lib/zoho";

/**
 * GET /api/enrollments/:id
 *
 * Returns 404 both when the record does not exist and when it exists but
 * belongs to another agent — a guessable id must not confirm the existence of
 * someone else's client.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await currentAgent();
  const scope = AgentScope.forAgent(agent.id, agent.name);

  const jot = await getJot(scope, id);
  if (!jot) return NextResponse.json({ error: "Not found." }, { status: 404 });

  return NextResponse.json({ jot });
}

/**
 * PATCH /api/enrollments/:id — the agent's corrections.
 *
 * The allowlist inside applyCorrections is the boundary: a key absent from it
 * is dropped whatever the browser sends, so the office's own pipeline fields
 * (`Enrollment_Stage`, `Enrollment_Date`, `FFM_*`, `Problems`,
 * `Classification`) can never be written from the field. The stage in
 * particular is what every KPI counts.
 *
 * Ownership is re-checked here, not inherited from having rendered the page.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await currentAgent();
  const scope = AgentScope.forAgent(agent.id, agent.name);

  let body: { patch?: Record<string, unknown> };
  try {
    body = (await req.json()) as { patch?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const patch = body.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return NextResponse.json({ error: "A patch object is required." }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  // Reduce to what an agent may actually write BEFORE touching the CRM, so a
  // patch of nothing but office-owned fields is refused without a round trip.
  const written = allowedCorrections(patch);
  if (Object.keys(written).length === 0) {
    return NextResponse.json(
      { error: "None of those fields can be corrected from the field app." },
      { status: 400 },
    );
  }

  try {
    const jot = await applyCorrections(scope, id, written);
    if (!jot) return NextResponse.json({ error: "Not found." }, { status: 404 });

    // `written` is echoed with Zoho api names so the client can show exactly
    // what was sent, and so the change is auditable from the response alone.
    return NextResponse.json({ jot, written });
  } catch (err) {
    if (isUpstreamError(err)) {
      console.error("[enrollments] correction failed:", err.message);
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    console.error("[enrollments] correction failed:", err);
    return NextResponse.json({ error: "The change could not be saved." }, { status: 502 });
  }
}

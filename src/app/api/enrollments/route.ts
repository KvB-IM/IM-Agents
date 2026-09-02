import { NextRequest, NextResponse } from "next/server";
import { currentAgent } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { draftToJot } from "@/lib/jot";
import { createJot, listJots } from "@/lib/store";
import { isUpstreamError } from "@/lib/zoho";
import type { CaptureDraft } from "@/lib/types";

/** GET /api/enrollments → this agent's own Jots. */
export async function GET() {
  const agent = await currentAgent();
  const scope = AgentScope.forAgent(agent.id, agent.name);
  try {
    return NextResponse.json({ jots: await listJots(scope) });
  } catch (err) {
    if (isUpstreamError(err)) {
      console.error("[enrollments] list failed:", err.message);
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    throw err;
  }
}

/**
 * POST /api/enrollments → create a JOTS record.
 *
 * The one thing neither existing app can do: IM_CRM_Frontend only PATCHes
 * existing Jots, because today they arrive from JotForm.
 *
 * Attribution is stamped from the session inside draftToJot and never read
 * from the body. `submissionKey` makes the call idempotent so a double-tap on
 * a bad connection does not file two applications.
 */
export async function POST(request: NextRequest) {
  const agent = await currentAgent();
  const scope = AgentScope.forAgent(agent.id, agent.name);

  let body: { draft?: CaptureDraft; submissionKey?: string };
  try {
    body = (await request.json()) as { draft?: CaptureDraft; submissionKey?: string };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const draft = body.draft;
  const submissionKey = body.submissionKey;

  if (!draft) return NextResponse.json({ error: "A draft is required." }, { status: 400 });
  if (!submissionKey || submissionKey.length > 128) {
    return NextResponse.json({ error: "A submissionKey is required." }, { status: 400 });
  }

  // Minimum viable application. Zoho makes Last_Name mandatory; the rest is
  // what makes a form workable rather than one the office has to chase.
  const primary = draft.people?.find((p) => p.relation === "primary") ?? draft.people?.[0];
  if (!primary?.lastName) {
    return NextResponse.json({ error: "A last name is required." }, { status: 400 });
  }
  if (!primary?.dateOfBirth) {
    return NextResponse.json({ error: "A date of birth is required." }, { status: 400 });
  }
  if (!draft.county?.fipsCode) {
    return NextResponse.json({ error: "A county is required. Look up the ZIP first." }, { status: 400 });
  }
  if (!draft.requestedEffective) {
    return NextResponse.json({ error: "A requested effective date is required." }, { status: 400 });
  }

  // The allowlist and the server-side attribution both live in draftToJot.
  // Whatever comes back is what reaches the CRM verbatim.
  const payload = draftToJot(draft, agent, submissionKey);

  // ── Dry run ───────────────────────────────────────────────────────────────
  // Returns the exact Zoho payload without writing it. Written for the same
  // reason IM-Website has HS_ENROLLMENT_MOCK: the thing worth inspecting is the
  // payload the real path would send, and reconstructing it by hand somewhere
  // else is how a "verified" mapping quietly diverges from the shipped one.
  //
  // Hard-gated off in production — the payload contains SSNs, and an endpoint
  // that echoes them back is not something to leave reachable on a deploy.
  if (
    new URL(request.url).searchParams.get("dryRun") === "1" &&
    process.env.NODE_ENV !== "production"
  ) {
    return NextResponse.json({ dryRun: true, module: "JOTS", payload });
  }

  try {
    const jot = await createJot(scope, payload);
    return NextResponse.json({ jot }, { status: 201 });
  } catch (err) {
    if (isUpstreamError(err)) {
      // The detail is logged; the agent sees only the sentence written for a
      // person, which for a rejected field names the field.
      console.error("[enrollments] create failed:", err.message);
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    console.error("[enrollments] create failed:", err);
    return NextResponse.json(
      { error: "The form could not be filed. Nothing was saved — try again." },
      { status: 502 },
    );
  }
}

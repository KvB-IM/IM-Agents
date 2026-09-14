import { NextRequest, NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { latestOpenDraft } from "@/lib/drafts";

/**
 * GET /api/drafts?latest=1 → the agent's most recent open draft, or null.
 *
 * The resume path. A browser with nothing useful in sessionStorage asks this
 * on load. The draft comes back WITHOUT its SSNs — only the list of people who
 * have one held — because SSNs are write-only from the field.
 */
export async function GET(request: NextRequest) {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (new URL(request.url).searchParams.get("latest") !== "1") {
    return NextResponse.json({ error: "Only ?latest=1 is supported." }, { status: 400 });
  }

  const stored = await latestOpenDraft(agent.id);
  if (!stored) return NextResponse.json({ draft: null });
  return NextResponse.json({
    draft: stored.draft,
    heldSsnKeys: stored.heldSsnKeys,
    resumeCode: stored.resumeCode,
    updatedAt: stored.updatedAt,
  });
}

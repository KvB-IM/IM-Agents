import { NextRequest, NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { saveDraft, loadDraft, discardDraft, isDraftId, draftsConfigured } from "@/lib/drafts";
import type { CaptureDraft } from "@/lib/types";

/**
 * The agent's own draft, by id. Every operation is scoped to the session's
 * agent inside lib/drafts.ts — the id alone never grants access.
 */

type Params = { params: Promise<{ id: string }> };

/** GET → the draft without its SSNs, plus which people have one held. */
export async function GET(_req: NextRequest, { params }: Params) {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  if (!isDraftId(id)) return NextResponse.json({ error: "Not a draft id." }, { status: 400 });

  const stored = await loadDraft(agent.id, id);
  if (!stored) return NextResponse.json({ error: "No such open draft." }, { status: 404 });
  return NextResponse.json({
    draft: stored.draft,
    heldSsnKeys: stored.heldSsnKeys,
    resumeCode: stored.resumeCode,
    updatedAt: stored.updatedAt,
  });
}

/**
 * PUT → mirror the browser's draft. Called debounced on every change.
 *
 * SSNs in the body are encrypted apart from the payload and merged with any
 * already held; nothing about them comes back except which people have one.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  if (!isDraftId(id)) return NextResponse.json({ error: "Not a draft id." }, { status: 400 });

  if (!draftsConfigured()) {
    /* No database or no encryption key: the browser copy is the only copy.
     * 204 rather than an error so the client does not retry in a loop. */
    return new NextResponse(null, { status: 204 });
  }

  let body: { draft?: CaptureDraft };
  try {
    body = (await request.json()) as { draft?: CaptureDraft };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const draft = body.draft;
  if (!draft || draft.id !== id || !Array.isArray(draft.people)) {
    return NextResponse.json({ error: "The draft does not match the URL." }, { status: 400 });
  }

  const result = await saveDraft(agent.id, draft);
  if (!result) {
    /* Another agent's draft, an already-submitted one, or a write failure the
     * module has already logged. The browser keeps its copy either way. */
    return NextResponse.json({ error: "The draft could not be saved." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, heldSsnKeys: result.heldSsnKeys });
}

/** DELETE → the agent discarded it. Submitted drafts are left for retention. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  if (!isDraftId(id)) return NextResponse.json({ error: "Not a draft id." }, { status: 400 });
  await discardDraft(agent.id, id);
  return NextResponse.json({ ok: true });
}

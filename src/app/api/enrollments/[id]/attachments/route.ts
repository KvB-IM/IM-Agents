import { NextRequest, NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { getJot } from "@/lib/store";
import { isUpstreamError } from "@/lib/zoho";
import { uploadAttachment, attachmentExists, listAttachments } from "@/lib/attachments";
import { readStaged, discardStaged, isStagedUrl, stagingConfigured } from "@/lib/staging";

export const dynamic = "force-dynamic";

/**
 * GET /api/enrollments/:id/attachments — what the CRM holds for this form.
 *
 * Scoped: the agent must own the Jot. An agent has a legitimate reason to check
 * whether the license they photographed actually arrived.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const scope = AgentScope.forAgent(agent.id, agent.name);
  const jot = await getJot(scope, id);
  if (!jot) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    return NextResponse.json({ attachments: await listAttachments(id) });
  } catch (err) {
    if (isUpstreamError(err)) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    throw err;
  }
}

/**
 * POST /api/enrollments/:id/attachments — forward a staged upload to the CRM.
 *
 * The sequence, and why it is this order:
 *
 *   1. Confirm the agent owns the Jot. An id is guessable.
 *   2. Confirm the URL is one of OUR staged blobs. Without this the endpoint
 *      fetches whatever URL it is handed, from wherever the server can reach —
 *      an SSRF carrying our credentials.
 *   3. Read the blob with credentials. The store is private.
 *   4. Push the bytes to Zoho.
 *   5. CONFIRM Zoho holds it — not merely that it returned success.
 *   6. Only then delete the staged copy.
 *
 * Step 5 is the one that matters. This codebase has already met two Zoho writes
 * that succeeded in shape and not in effect, and deleting the only copy of a
 * client's identity document on the strength of a 2xx would be the expensive
 * version of that mistake. An unconfirmed attachment leaves the blob for the
 * 14-day sweep instead.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!stagingConfigured()) {
    return NextResponse.json(
      { error: "Document uploads are not configured on this deployment." },
      { status: 501 },
    );
  }

  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const scope = AgentScope.forAgent(agent.id, agent.name);
  const jot = await getJot(scope, id);
  if (!jot) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body: { url?: unknown; filename?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  if (!isStagedUrl(body.url)) {
    return NextResponse.json(
      { error: "That is not a staged upload." },
      { status: 400 },
    );
  }
  const url = body.url;

  /* Filename is used verbatim in a multipart part name, so strip path
   * separators and bound the length. */
  const filename =
    String(body.filename || "license.jpg")
      .replace(/[/\\]/g, "_")
      .slice(0, 200) || "license.jpg";

  /* Named steps. IM_CRM_Frontend's comment on the equivalent endpoint says
   * "Something went wrong" cost several rounds of guessing on exactly this
   * path, and it was right — three of the four failure modes here look
   * identical from the browser. */
  let step: "read" | "attach" | "confirm" = "read";
  let confirmed = false;

  try {
    const staged = await readStaged(url);

    step = "attach";
    const attachmentId = await uploadAttachment(id, {
      filename,
      buffer: staged.buffer,
      contentType: staged.contentType,
    });

    step = "confirm";
    confirmed = await attachmentExists(id, attachmentId);

    if (!confirmed) {
      /* Zoho accepted it and does not list it. Do NOT report success and do NOT
       * delete the staged copy — this is the case the confirmation exists for. */
      console.error(
        `[attachments] ${id}: Zoho returned attachment ${attachmentId} but does not list it. ` +
          `Staged copy retained.`,
      );
      return NextResponse.json(
        {
          error:
            "The CRM accepted the photo but does not show it yet. It is still saved here — " +
            "tell the office rather than re-taking it.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, attachmentId, size: staged.size }, { status: 201 });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[attachments] ${id} failed at ${step}: ${detail}`);

    if (isUpstreamError(err)) {
      return NextResponse.json({ error: err.userMessage, step }, { status: err.status });
    }
    return NextResponse.json(
      {
        error:
          step === "read"
            ? "The photo could not be read back from storage. It is still there — try again."
            : "The photo could not be attached to the CRM. It is still saved here.",
        step,
      },
      { status: 502 },
    );
  } finally {
    /* Deleted ONLY on confirmation. Anything else leaves it for the sweep,
     * because the staged copy may be the only one that exists — the phone's
     * camera roll is not a guarantee, and an agent who has moved on cannot
     * re-photograph a license that is no longer in front of them. */
    if (confirmed) await discardStaged(url);
  }
}

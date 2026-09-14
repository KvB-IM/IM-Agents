import { NextRequest, NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { draftToJot } from "@/lib/jot";
import { createJot, listJots } from "@/lib/store";
import { isUpstreamError } from "@/lib/zoho";
import { ssnConfirmed, ssnDigits, ssnProblem } from "@/lib/ssn";
import { recordAttempt, settleAttempt } from "@/lib/submissions";
import { clientIpFrom } from "@/lib/auth";
import {
  createEnrollmentSession,
  draftToEnrollmentSession,
  hsHandoffEnabled,
  hsMockEnabled,
  isEnrollmentFlow,
} from "@/lib/enrollmentSession";
import { hsConfigured, HealthSherpaUpstreamError } from "@/lib/healthsherpa";
import { isEnrollmentPath } from "@/lib/types";
import { heldSsns, markSubmitted, isDraftId } from "@/lib/drafts";
import { mergeSsns } from "@/lib/draftSsn";
import type { CaptureDraft, EnrollmentPath } from "@/lib/types";

/** GET /api/enrollments → this agent's own Jots. */
export async function GET() {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const scope = AgentScope.forAgent(agent.id, agent.name);

  let body: { draft?: CaptureDraft; submissionKey?: string; path?: unknown };
  try {
    body = (await request.json()) as {
      draft?: CaptureDraft;
      submissionKey?: string;
      path?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  let draft = body.draft;
  const submissionKey = body.submissionKey;

  /* Absent defaults to "office" — the historical path, and the one that hands
   * nothing to an outside service. An unrecognised value is rejected rather
   * than coerced: silently filing an intended HealthSherpa handoff as an office
   * form would put the wrong Form_Type on the record and the office would work
   * a form the agent had already enrolled. */
  const requestedPath = body.path ?? "office";
  if (!isEnrollmentPath(requestedPath)) {
    return NextResponse.json({ error: "Unrecognised enrollment path." }, { status: 400 });
  }
  const path: EnrollmentPath = requestedPath;

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

  /* ── Held SSNs ──────────────────────────────────────────────────────────
   * A resumed draft arrives with blank SSN fields: the number was saved to
   * the server-side draft, encrypted, and is never returned to a browser. It
   * is merged in HERE, before validation, so the checks below see a complete
   * application. A typed value wins over a held one; an attestation of "never
   * issued" is left alone. Non-fatal — if the lookup fails, validation runs on
   * what the browser sent and asks for the SSN the ordinary way. */
  if (isDraftId(draft.id)) {
    try {
      draft = mergeSsns(draft, await heldSsns(agent.id, draft.id));
    } catch (err) {
      console.error("[enrollments] held-SSN merge failed:", err);
    }
  }

  /* SSN is required for everyone seeking coverage, and must match its
   * confirmation. The stepper blocks this client-side, but the check belongs
   * here too — the browser is not the boundary, and a form filed with a
   * mistyped SSN bounces at the exchange and costs the client their coverage
   * date. */
  for (const person of draft.people ?? []) {
    if (!person.seekingCoverage) continue;
    // The never-issued attestation stands in for a number. HealthSherpa and the
    // Jot both model this explicitly, so requiring an SSN unconditionally would
    // block a lawful enrollment.
    if (person.noSsn) continue;
    const who = [person.firstName, person.lastName].filter(Boolean).join(" ") || "an applicant";
    const problem = ssnProblem(ssnDigits(person.ssn ?? ""));
    if (problem) {
      return NextResponse.json({ error: `${who}: ${problem}` }, { status: 400 });
    }
    if (!ssnConfirmed(person.ssn ?? "", person.ssnConfirm ?? "")) {
      return NextResponse.json(
        { error: `${who}: the two SSN entries do not match.` },
        { status: 400 },
      );
    }
  }

  /* ── Can the handoff actually happen? ─────────────────────────────────────
   * Checked HERE, before the Jot is written, so a handoff that cannot work
   * fails with nothing half-done and the agent can file to the office instead.
   * Discovering it after the create would leave a record marked "enrolled in
   * the field" for a client nobody enrolled.
   *
   * The flag is re-checked server-side on purpose. The review screen hides the
   * button when it is off, but the browser is not the boundary. */
  if (path === "healthsherpa") {
    if (!hsHandoffEnabled()) {
      return NextResponse.json(
        { error: "The HealthSherpa handoff is not switched on. File to the office instead." },
        { status: 409 },
      );
    }
    if (!hsConfigured() && !hsMockEnabled()) {
      return NextResponse.json(
        { error: "HealthSherpa is not connected. File to the office instead." },
        { status: 409 },
      );
    }
  }

  // The allowlist and the server-side attribution both live in draftToJot.
  // Whatever comes back is what reaches the CRM verbatim.
  const payload = draftToJot(draft, agent, submissionKey, path);

  // ── Dry run ───────────────────────────────────────────────────────────────
  // Returns the exact Zoho payload without writing it. Written for the same
  // reason IM-Website has HS_ENROLLMENT_MOCK: the thing worth inspecting is the
  // payload the real path would send, and reconstructing it by hand somewhere
  // else is how a "verified" mapping quietly diverges from the shipped one.
  //
  // Hard-gated off in production — the payload contains SSNs, and an endpoint
  // that echoes them back is not something to leave reachable on a deploy.
  const params = new URL(request.url).searchParams;
  if (params.get("dryRun") === "1" && process.env.NODE_ENV !== "production") {
    const probeFormId = String(payload.Name ?? "");
    /* `flow=` lets the probe try the OTHER flow without changing the default
     * the live path uses. Dev-only, like everything in this branch. */
    const flowParam = params.get("flow");
    const probeFlow = isEnrollmentFlow(flowParam) ? flowParam : undefined;
    const session =
      path === "healthsherpa"
        ? draftToEnrollmentSession(draft, probeFormId, probeFlow)
        : undefined;

    /* ── Forwarding probe: dryRun=1&forward=1 ─────────────────────────────
     * Sends the session payload to HealthSherpa FOR REAL and writes NOTHING to
     * Zoho. It exists because the only other way to find out whether
     * HealthSherpa accepts our payload is to file a production Jot first — the
     * live path is Jot-then-handoff on purpose — and a test record in the
     * office's queue is not an acceptable price for a contract check.
     *
     * Safe to run repeatedly: an enrollment session "does not create direct
     * enrollment application records" (their words), so a probe leaves a
     * pre-filled deep link on their side and nothing else. Dev-only, like the
     * rest of dryRun. Skipped when the mock is on — there would be nothing to
     * learn. */
    let forwarded: unknown;
    if (session && params.get("forward") === "1" && !hsMockEnabled()) {
      try {
        forwarded = {
          ok: true,
          links: await createEnrollmentSession(draft, probeFormId, probeFlow),
        };
      } catch (e) {
        forwarded = {
          ok: false,
          status: e instanceof HealthSherpaUpstreamError ? e.status : null,
          message: e instanceof HealthSherpaUpstreamError ? e.userMessage : String(e),
          /* The upstream body verbatim — this is the field to read when the
           * answer is 400: it names the offending key. */
          detail: e instanceof Error ? e.message : String(e),
        };
      }
    }

    return NextResponse.json({
      dryRun: true,
      module: "JOTS",
      path,
      payload,
      /* The session payload is the half a dry run could not previously show,
       * and it is the half that has never been accepted by HealthSherpa. */
      ...(session ? { session } : {}),
      ...(forwarded !== undefined ? { forwarded } : {}),
    });
  }

  /* ── Replay buffer ────────────────────────────────────────────────────────
   * Written BEFORE the CRM call, so a Zoho rejection leaves a reconcilable row
   * rather than nothing. Two rejections found in development would each have
   * destroyed a finished application in the field, which is what this is for.
   *
   * Non-fatal on purpose: if the buffer write fails the submission still goes
   * ahead. The buffer exists to catch Zoho failures, and letting a database
   * outage block every field submission would be the worse failure. SSNs are
   * reduced to last-four inside recordAttempt. */
  const formId = String(payload.Name ?? "");
  const buffered = await recordAttempt(
    {
      agentId: agent.id,
      formId,
      clientName: [primary.firstName, primary.lastName].filter(Boolean).join(" "),
      requestedEffective: draft.requestedEffective,
      carrier: String(payload.Carrier1 ?? ""),
      clientIp: clientIpFrom(request.headers),
      userAgent: request.headers.get("user-agent"),
    },
    payload,
  );

  try {
    const jot = await createJot(scope, payload);
    /* Settled as success whether this was a fresh create or a replay that
     * resolved to the record already filed — either way the application is in
     * the CRM and is not what reconciliation is looking for. */
    if (buffered) await settleAttempt(formId, "success", { zohoId: jot.id });
    /* The draft reached the CRM: no longer offered for resume, purged after
     * the retention window. Non-fatal inside. */
    if (isDraftId(draft.id)) await markSubmitted(agent.id, draft.id, jot.id);

    if (path !== "healthsherpa") {
      return NextResponse.json({ jot }, { status: 201 });
    }

    /* ── The handoff ──────────────────────────────────────────────────────────
     * Deliberately AFTER the Jot exists. Handing a client to HealthSherpa is
     * the un-undoable step, and doing it first would risk an application being
     * worked over there with nothing in the CRM pointing at it — an orphan with
     * no symptom, while the client sits at the table.
     *
     * `Name` is passed as `external_id`, so the CRM record and the HealthSherpa
     * session carry ONE identifier and a rep can search either system with it.
     *
     * A failure here is NOT a failed submission. The Jot is filed and correct;
     * only the convenience of a pre-filled browser is missing, and the agent
     * can enroll on HealthSherpa unaided. So this returns 201 with the record
     * and says what went wrong, rather than an error that would read as "your
     * application did not save" and send the agent through six steps again. */
    if (hsMockEnabled()) {
      return NextResponse.json(
        { jot, mock: true, session: draftToEnrollmentSession(draft, formId) },
        { status: 201 },
      );
    }

    try {
      const links = await createEnrollmentSession(draft, formId);
      return NextResponse.json({ jot, links }, { status: 201 });
    } catch (hsErr) {
      const detail =
        hsErr instanceof HealthSherpaUpstreamError ? hsErr.userMessage : String(hsErr);
      console.error("[enrollments] handoff failed:", detail);
      return NextResponse.json(
        {
          jot,
          handoffError:
            "The form is filed, but HealthSherpa could not be opened with it pre-filled. Enroll the client on HealthSherpa directly — quote the form ID to the office.",
        },
        { status: 201 },
      );
    }
  } catch (err) {
    if (isUpstreamError(err)) {
      // The detail is logged; the agent sees only the sentence written for a
      // person, which for a rejected field names the field.
      console.error("[enrollments] create failed:", err.message);
      if (buffered) await settleAttempt(formId, "rejected", { error: err.message });
      /* Tell the agent it was saved. This is the COMMON failure path — a Zoho
       * rejection arrives as an upstream error — and it previously returned
       * Zoho's message alone, so an agent whose form WAS safely buffered had
       * no way to know and would re-enter the whole application. */
      return NextResponse.json(
        {
          error: buffered
            ? `${err.userMessage} It has been saved here for the office to retry — do not re-enter it.`
            : err.userMessage,
        },
        { status: err.status },
      );
    }
    console.error("[enrollments] create failed:", err);
    if (buffered) await settleAttempt(formId, "error", { error: String(err) });
    return NextResponse.json(
      {
        error: buffered
          ? "The form could not be filed with the CRM. It has been saved here and the office can retry it — do not re-enter it."
          : "The form could not be filed. Nothing was saved — try again.",
      },
      { status: 502 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { dbConfigured } from "@/lib/db";
import {
  isAdmin, listAgents, createAgent, disableAgent, enableAgent,
  resetPassword, setAdmin, countAdmins,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

/**
 * Agent administration.
 *
 * Every method re-establishes that the caller is an admin. The page also hides
 * itself from non-admins, but that is presentation — this is the boundary, and
 * it is checked per request rather than inherited from having rendered a page.
 */
async function requireAdmin() {
  if (!dbConfigured()) {
    return { error: NextResponse.json({ error: "No database configured." }, { status: 503 }) };
  }
  const agent = await currentAgentOrNull();
  if (!agent) {
    return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  }
  if (!(await isAdmin(agent.id))) {
    return { error: NextResponse.json({ error: "Admins only." }, { status: 403 }) };
  }
  return { agent };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json({ agents: await listAgents(), me: gate.agent.id });
}

/** POST — create an agent. Returns the first password ONCE. */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  let body: { email?: string; zohoAgentName?: string; agency?: string; isAdmin?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const result = await createAgent({
    email: String(body.email ?? ""),
    zohoAgentName: String(body.zohoAgentName ?? ""),
    agency: String(body.agency ?? ""),
    isAdmin: body.isAdmin === true,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  /* The password is returned exactly once and never stored in readable form.
   * The admin has to pass it to the agent now — there is no "show it again",
   * only a reset. */
  return NextResponse.json(
    { ok: true, id: result.id, password: result.password },
    { status: 201 },
  );
}

/** PATCH — disable, enable, reset a password, or change the admin flag. */
export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  let body: { agentId?: string; action?: string; value?: boolean };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const agentId = String(body.agentId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(agentId)) {
    return NextResponse.json({ error: "A valid agent id is required." }, { status: 400 });
  }

  switch (body.action) {
    case "disable": {
      /* An admin disabling themselves would end their own session mid-action,
       * and disabling the last admin locks everyone out of administration —
       * recoverable only by running the CLI against the database. */
      if (agentId === gate.agent.id) {
        return NextResponse.json(
          { error: "You cannot disable your own account." },
          { status: 400 },
        );
      }
      const revoked = await disableAgent(agentId);
      return NextResponse.json({ ok: true, revokedSessions: revoked });
    }

    case "enable":
      await enableAgent(agentId);
      return NextResponse.json({ ok: true });

    case "reset": {
      const password = await resetPassword(agentId);
      return NextResponse.json({ ok: true, password });
    }

    case "admin": {
      const value = body.value === true;
      if (!value && (await countAdmins()) <= 1) {
        return NextResponse.json(
          { error: "That is the only active admin. Grant admin to someone else first." },
          { status: 400 },
        );
      }
      if (!value && agentId === gate.agent.id) {
        return NextResponse.json(
          { error: "You cannot remove your own admin access." },
          { status: 400 },
        );
      }
      await setAdmin(agentId, value);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json(
        { error: "Unknown action. Use disable, enable, reset or admin." },
        { status: 400 },
      );
  }
}

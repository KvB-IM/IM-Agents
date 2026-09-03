import { AlertTriangle, Clock, Inbox } from "lucide-react";
import { requireAgent } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { listJots } from "@/lib/store";
import { computeKpis, STALL_DAYS } from "@/lib/kpis";
import type { StageCount } from "@/lib/kpis";
import { Card, CardHeader, Inset } from "@/components/ui";
import SignOutButton from "@/components/SignOutButton";
import ZohoConnection from "@/components/ZohoConnection";
import AgentAdmin from "@/components/AgentAdmin";
import { dbConfigured, sql } from "@/lib/db";
import { zohoCredentials } from "@/lib/zohoToken";

/* Rendered per request, never prerendered: these read the agent's own records,
   and a statically generated page would bake one agent's submissions into the
   build output and serve it to everyone. */
export const dynamic = "force-dynamic";

/**
 * Agent production, built on Enrollment_Stage.
 *
 * No money anywhere on this screen. A field agent needs to see where their
 * forms are and which ones are waiting on them; premium and commission are the
 * office's business and putting them here invites an argument this app cannot
 * settle.
 *
 * The stage funnel is the screen. The three tiles underneath are the only
 * things that are not a stage, and each one is a call to action rather than a
 * statistic.
 */
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<{ zoho?: string }>;
}) {
  const agent = await requireAgent("/me");
  const { zoho } = await searchParams;
  const scope = AgentScope.forAgent(agent.id, agent.name);
  const jots = await listJots(scope);
  const k = computeKpis(jots);

  const actions = [
    {
      label: "Waiting on you",
      value: k.needsYou,
      sub:
        k.openProblems > 0
          ? `${k.openProblems} ${k.openProblems === 1 ? "problem" : "problems"} flagged`
          : "nothing flagged",
      Icon: AlertTriangle,
      hot: k.needsYou > 0,
    },
    {
      label: "Not staged yet",
      value: k.unstaged,
      sub: "office has not picked up",
      Icon: Inbox,
      hot: false,
    },
    {
      label: "Sitting still",
      value: k.stalled,
      sub: `${STALL_DAYS}+ days, unresolved`,
      Icon: Clock,
      hot: k.stalled > 0,
    },
  ];

  return (
    <div className="space-y-4">
      <Inset>
        <h1 className="text-[22px] font-bold tracking-tight text-navy-900">{agent.name}</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          {agent.agency} · {k.submitted} {k.submitted === 1 ? "form" : "forms"} submitted
          {k.submittedThisMonth > 0 ? `, ${k.submittedThisMonth} this month` : ""}
        </p>
      </Inset>

      {/* ── The funnel ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Where your forms are"
          hint={
            k.enrolledRateOfResolved === null
              ? "Nothing has finished either way yet."
              : `${Math.round(k.enrolledRateOfResolved * 100)}% of finished forms enrolled.`
          }
        />
        <ul className="space-y-3 px-4 pb-4">
          {k.stages.map((stage) => (
            <StageBar key={stage.key} stage={stage} total={k.submitted} />
          ))}
        </ul>
      </Card>

      {/* ── Actions, not statistics ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-px overflow-hidden border-y border-line bg-line sm:gap-3 sm:rounded-2xl sm:border-0 sm:bg-transparent">
        {actions.map(({ label, value, sub, Icon, hot }) => (
          <div
            key={label}
            className="bg-white p-3.5 sm:rounded-2xl sm:ring-1 sm:ring-line"
          >
            <Icon
              size={15}
              className={hot ? "text-warning" : "text-muted"}
              aria-hidden
            />
            <p
              className={`mt-2 text-[24px] font-bold leading-none tracking-tight ${
                hot ? "text-warning" : "text-navy-900"
              }`}
            >
              {value}
            </p>
            <p className="mt-1 text-[12px] font-medium leading-tight text-navy-800">{label}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</p>
          </div>
        ))}
      </div>

      {/* ── What the numbers mean ──────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="How these are counted"
          hint="So this screen and the office's report agree."
        />
        <ul className="space-y-2.5 px-4 pb-4 text-[12px] leading-relaxed text-muted">
          <li>
            Everything here comes from the form&apos;s{" "}
            <strong className="font-semibold text-navy-800">enrollment stage</strong>, which the
            office sets. This app never guesses it.
          </li>
          <li>
            <strong className="font-semibold text-navy-800">Not staged yet</strong> is normal for
            anything recent — it means submitted and not yet picked up, not lost.
          </li>
          <li>
            <strong className="font-semibold text-navy-800">Enrolled %</strong> is measured against
            forms that finished, not against everything you have submitted, so forms still in
            flight do not drag it down.
          </li>
          <li>
            <strong className="font-semibold text-navy-800">Sitting still</strong> is a prompt to
            call the office, not a judgement.
          </li>
        </ul>
      </Card>

      {/* Admin-only. Connecting the CRM points the whole portal at one Zoho
          org, so it is not a field-agent capability. */}
      {await adminPanel(agent.id, zoho)}

      <Inset>
        <SignOutButton />
      </Inset>
    </div>
  );
}

/**
 * One stage row: count, label, and a proportional bar.
 *
 * A bar rather than a number alone because the useful question is "how much of
 * my book is stuck here", which is a proportion. A zero-count row still renders
 * a track so the funnel does not visibly reflow as forms move through it.
 */
function StageBar({ stage, total }: { stage: StageCount; total: number }) {
  const barTone = {
    waiting: "bg-navy-600",
    progress: "bg-gold-500",
    done: "bg-success",
    failed: "bg-error",
    unknown: "bg-navy-100",
  }[stage.tone as "waiting" | "progress" | "done" | "failed" | "unknown"];

  const pct = total ? Math.round(stage.share * 100) : 0;

  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-navy-900">{stage.label}</span>
        <span className="shrink-0 text-[13px] font-bold tabular-nums text-navy-900">
          {stage.count}
          {stage.count > 0 ? (
            <span className="ml-1 text-[11px] font-medium text-muted">{pct}%</span>
          ) : null}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-navy-50">
        <div
          className={`h-full rounded-full ${barTone}`}
          style={{ width: `${Math.max(stage.count > 0 ? 3 : 0, stage.share * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{stage.meaning}</p>
    </li>
  );
}


/**
 * The CRM connection panel, rendered only for admins.
 *
 * Returns null for everyone else — including when there is no database, where
 * there are no roles to check and the connection is managed by environment
 * variable anyway.
 */
async function adminPanel(agentId: string, zoho: string | undefined) {
  if (!dbConfigured()) return null;

  try {
    const db = sql();
    const rows = (await db`
      select is_admin from agents where id = ${agentId} limit 1
    `) as Array<{ is_admin: boolean }>;
    if (!rows[0]?.is_admin) return null;

    const conn = (await db`
      select scopes, connected_at, last_error, last_error_at
        from zoho_connection where id = true limit 1
    `) as Array<{
      scopes: string | null;
      connected_at: string | null;
      last_error: string | null;
      last_error_at: string | null;
    }>;

    const creds = await zohoCredentials();
    const row = conn[0];

    return (
      <div className="space-y-4">
        <AgentAdmin />
        <ZohoConnection
          connected={Boolean(creds)}
          connectedAt={
            row?.connected_at ? new Date(row.connected_at).toLocaleString("en-US") : null
          }
          scopes={row?.scopes ?? null}
          lastError={row?.last_error ?? null}
          status={zoho === "connected" ? "connected" : zoho === "error" ? "error" : null}
        />
      </div>
    );
  } catch (err) {
    // A profile page must render even if this query fails — the panel is
    // administrative, and an agent looking at their own production numbers
    // should not get an error page because a schema migration has not run.
    console.error("[me] admin panel unavailable:", err);
    return null;
  }
}

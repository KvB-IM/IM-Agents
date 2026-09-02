import Link from "next/link";
import { ChevronRight, AlertTriangle, Clock } from "lucide-react";
import { currentAgent } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { listJots } from "@/lib/store";
import { shortDate, daysSince } from "@/lib/format";
import { stageLabel, stageTone, isTerminal } from "@/lib/stages";
import { Badge, Empty, Inset } from "@/components/ui";
import type { Jot } from "@/lib/types";

/* Rendered per request, never prerendered: these read the agent's own records,
   and a statically generated page would bake one agent's pipeline into the
   build output and serve it to everyone. */
export const dynamic = "force-dynamic";

/** Stage tone → badge tone. */
const BADGE_TONE = {
  waiting: "progress",
  progress: "gold",
  done: "live",
  failed: "closed",
  unknown: "neutral",
} as const;

/**
 * The agent's own submitted forms.
 *
 * Forms needing the agent are pulled to the top. A queue that buries the two
 * forms with problems under fifteen that are fine is a queue nobody opens
 * twice.
 */
export default async function PipelinePage() {
  const agent = await currentAgent();
  const scope = AgentScope.forAgent(agent.id, agent.name);
  const jots = await listJots(scope);

  const needsAgent = jots.filter(
    (j) => j.problems.length > 0 || j.requiredDocuments.length > 0 || j.requirementDue,
  );
  const open = jots.filter((j) => !needsAgent.includes(j) && !isTerminal(j.enrollmentStage));
  const done = jots.filter((j) => !needsAgent.includes(j) && isTerminal(j.enrollmentStage));

  return (
    <div className="space-y-4">
      <Inset>
        <h1 className="text-[22px] font-bold tracking-tight text-navy-900">Pipeline</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          {jots.length} {jots.length === 1 ? "form" : "forms"} you have submitted.
        </p>
      </Inset>

      {jots.length === 0 ? (
        <Empty
          title="Nothing submitted yet"
          body="Run a quote, take the application, and it will show up here with whatever the office needs from you."
        />
      ) : null}

      {needsAgent.length > 0 ? (
        <Group
          title={`Needs you (${needsAgent.length})`}
          tone="warning"
          jots={needsAgent}
          icon
        />
      ) : null}

      {open.length > 0 ? (
        <Group title="In flight" tone="muted" jots={open} />
      ) : null}

      {done.length > 0 ? (
        <Group title="Finished" tone="muted" jots={done} />
      ) : null}
    </div>
  );
}

function Group({
  title,
  tone,
  jots,
  icon,
}: {
  title: string;
  tone: "warning" | "muted";
  jots: Jot[];
  icon?: boolean;
}) {
  return (
    <section>
      <h2
        className={`flex items-center gap-1.5 px-4 pb-2 text-[12px] font-semibold uppercase tracking-wide ${
          tone === "warning" ? "text-warning" : "text-muted"
        }`}
      >
        {icon ? <AlertTriangle size={13} aria-hidden /> : null}
        {title}
      </h2>
      {/* Full-bleed rows on a phone, separated by hairlines rather than gaps.
          At sm+ they become spaced cards. */}
      <ul className="divide-y divide-line border-y border-line bg-white sm:space-y-2 sm:divide-y-0 sm:border-0 sm:bg-transparent">
        {jots.map((jot) => (
          <li key={jot.id}>
            <JotRow jot={jot} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function JotRow({ jot }: { jot: Jot }) {
  const age = daysSince(jot.submittedAt);
  const stale = !isTerminal(jot.enrollmentStage) && age !== null && age >= 21;

  return (
    <Link
      href={`/pipeline/${jot.id}`}
      className="block bg-white px-4 py-3.5 active:bg-navy-50/60 sm:rounded-2xl sm:ring-1 sm:ring-line"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-navy-900">{jot.clientName}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {jot.carrier} · {jot.plan}
          </p>
        </div>
        <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" aria-hidden />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge tone={BADGE_TONE[stageTone(jot.enrollmentStage)]}>
          {stageLabel(jot.enrollmentStage) || "Not staged yet"}
        </Badge>
        {jot.problems.length > 0 ? (
          <Badge tone="attention">
            {jot.problems.length} {jot.problems.length === 1 ? "problem" : "problems"}
          </Badge>
        ) : null}
        {jot.requiredDocuments.length > 0 ? (
          <Badge tone="attention">
            {jot.requiredDocuments.length} {jot.requiredDocuments.length === 1 ? "doc" : "docs"}
          </Badge>
        ) : null}
        {jot.requirementDue ? (
          <Badge tone="attention">
            <Clock size={11} aria-hidden /> {shortDate(jot.requirementDue)}
          </Badge>
        ) : null}
        {stale ? <Badge tone="closed">{age}d</Badge> : null}
      </div>

      <p className="mt-2 text-[11px] text-muted">
        Submitted {shortDate(jot.submittedAt)} · effective{" "}
        {shortDate(jot.requestedEffective)}
      </p>
    </Link>
  );
}

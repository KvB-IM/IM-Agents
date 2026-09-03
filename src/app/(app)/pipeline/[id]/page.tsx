import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, AlertTriangle, FileCheck2, Clock } from "lucide-react";
import { requireAgent } from "@/lib/session";
import { AgentScope } from "@/lib/scope";
import { getJot, CORRECTION_GROUPS } from "@/lib/store";
import { monthYear, shortDate } from "@/lib/format";
import { stageLabel, stageTone, STAGES, stageKeyOf, UNSTAGED, OTHER } from "@/lib/stages";
import { Card, CardHeader, Badge, Inset } from "@/components/ui";
import CorrectionForm from "@/components/CorrectionForm";

export const dynamic = "force-dynamic";

const BADGE_TONE = {
  waiting: "progress",
  progress: "gold",
  done: "live",
  failed: "closed",
  unknown: "neutral",
} as const;

/**
 * One form: where it stands, and what the office needs from the agent.
 *
 * `Problems` and `Required_Documents` are already written by the back office in
 * Zoho today; nothing currently shows them to the person who can act on them.
 * That is the whole point of this screen.
 */
export default async function JotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await requireAgent(`/pipeline/${id}`);
  const scope = AgentScope.forAgent(agent.id, agent.name);

  const jot = await getJot(scope, id);
  // Also 404 when the form exists but belongs to another agent — a guessable
  // id must not confirm someone else's client exists.
  if (!jot) notFound();

  const needsAgent = jot.problems.length > 0 || jot.requiredDocuments.length > 0;
  const stageKey = stageKeyOf(jot.enrollmentStage);
  const meaning = STAGES.find((s) => s.key === stageKey)?.meaning ?? "";

  return (
    <div className="space-y-4">
      <Inset>
        <Link
          href="/pipeline"
          className="tap -ml-1 inline-flex items-center gap-1 text-[13px] font-medium text-navy-700"
        >
          <ChevronLeft size={16} aria-hidden /> Pipeline
        </Link>

        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-navy-900">
            {jot.clientName}
          </h1>
          <Badge tone={BADGE_TONE[stageTone(jot.enrollmentStage)]}>
            {stageLabel(jot.enrollmentStage) || "Not staged"}
          </Badge>
        </div>
        <p className="mt-0.5 text-[13px] text-muted">{meaning}</p>
      </Inset>

      {/* ── What the office needs ──────────────────────────────────────── */}
      {needsAgent ? (
        <Card className="sm:ring-1 sm:ring-warning/30">
          <CardHeader
            title="The office needs something"
            hint="Fix these and this form starts moving again."
          />
          <ul className="space-y-2 px-4 pb-4">
            {jot.problems.map((p) => (
              <li
                key={p}
                className="flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[13px] font-medium text-navy-900 ring-1 ring-warning/20"
              >
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                {p}
              </li>
            ))}
            {jot.requiredDocuments.map((d) => (
              <li
                key={d}
                className="rounded-xl bg-navy-50 px-3 py-2.5 text-[13px] font-medium text-navy-900 ring-1 ring-navy-100"
              >
                {d}
              </li>
            ))}
          </ul>
          {jot.requirementDue ? (
            <p className="flex items-center gap-1.5 border-t border-line px-4 py-3 text-[12px] font-medium text-warning">
              <Clock size={14} aria-hidden /> Due {shortDate(jot.requirementDue)}
              {jot.requirementStage ? ` · ${jot.requirementStage}` : ""}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* ── Corrections ────────────────────────────────────────────────── */}
      {/* Offered on EVERY form the agent owns, not only ones the office has
          flagged. The gate used to be `needsAgent`, which meant an agent who
          spotted their own typo — a transposed date of birth, a wrong ZIP —
          had no way to fix it and no way to say so, and the form sat with bad
          data until the office happened to catch it. Waiting for someone else
          to notice your mistake is not a workflow.

          Collapsed by default: reading a form must not be one keystroke from
          altering it. The server allowlist is the real boundary either way —
          the stage, classification and FFM ids can never be written here. */}
      <CorrectionForm
        jotId={jot.id}
        groups={CORRECTION_GROUPS}
        documents={jot.requiredDocuments}
        label={needsAgent ? "Fix what the office needs" : "Correct this application"}
      />

      {/* ── Policy, once converted ─────────────────────────────────────── */}
      {jot.policyId ? (
        <div className="mx-4 flex items-start gap-2.5 rounded-2xl bg-success/5 px-4 py-3.5 ring-1 ring-success/20">
          <FileCheck2 size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-[14px] font-semibold text-navy-900">Converted to a policy</p>
            <p className="mt-0.5 text-[12px] text-muted">{jot.policyName}</p>
          </div>
        </div>
      ) : null}

      {/* ── The form ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="What was submitted" />
        <dl className="divide-y divide-line px-4 pb-2">
          {[
            ["Form ID", jot.formId],
            ["Plan", jot.plan],
            ["Carrier", jot.carrier],
            ["Metal level", jot.metalLevel],
            ["Effective", monthYear(jot.requestedEffective)],
            ["Household size", jot.householdSize === null ? "—" : String(jot.householdSize)],
            ["Submitted", shortDate(jot.submittedAt)],
            [
              "Enrollment stage",
              stageKey === UNSTAGED
                ? "not staged by the office yet"
                : stageKey === OTHER
                  ? `${jot.enrollmentStage} (new stage)`
                  : stageLabel(jot.enrollmentStage),
            ],
            ["Validity", jot.classification || "not classified yet"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-[13px] text-muted">{k}</dt>
              <dd className="text-right text-[13px] font-medium text-navy-900">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="border-t border-line px-4 py-3 text-[12px] leading-snug text-muted">
          Applicant SSNs are not shown. They were submitted with the form and cannot be read back
          from the field.
        </p>
      </Card>
    </div>
  );
}

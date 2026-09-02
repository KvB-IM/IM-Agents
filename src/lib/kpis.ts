import "server-only";
import type { Jot } from "./types";
import { daysSince } from "./format";
import {
  STAGES, stageKeyOf, stageMeta, isTerminal,
  ENROLLED, FAILED, UNSTAGED, type StageKey,
} from "./stages";

/**
 * Agent production, built on Enrollment_Stage.
 *
 * Deliberately contains no money. A field agent's screen shows movement —
 * where their forms are and which ones need them — not premium or commission.
 *
 * Every figure comes from a list that was already scope-filtered, and there is
 * no period or agent parameter taken from the caller: an agent's numbers are
 * derived from their own records or not at all.
 */

export interface StageCount {
  key: StageKey;
  label: string;
  meaning: string;
  tone: string;
  count: number;
  /** Share of all this agent's forms, 0-1. Drives the bar width. */
  share: number;
  funnel: boolean;
}

export interface Kpis {
  submitted: number;
  submittedThisMonth: number;
  /** Per-stage breakdown, funnel order. Empty buckets are dropped except the
   *  ones that are always meaningful to see at zero. */
  stages: StageCount[];
  enrolled: number;
  failed: number;
  unstaged: number;
  /** Enrolled as a share of forms the office has actually resolved. Null until
   *  something has resolved — a 0% that means "nothing has finished yet" is
   *  worse than no number. */
  enrolledRateOfResolved: number | null;
  /** Forms carrying problems or document requests. */
  needsYou: number;
  openProblems: number;
  requirementsDue: number;
  /** Not terminal, no movement in STALL_DAYS. */
  stalled: number;
  oldestOpenDays: number | null;
}

const STALL_DAYS = 21;

/** Buckets worth showing even at zero, because their absence is information. */
const ALWAYS_SHOW = new Set<StageKey>([ENROLLED, FAILED]);

export function computeKpis(jots: Jot[], now = new Date()): Kpis {
  const thisMonth = now.toISOString().slice(0, 7);

  const counts = new Map<StageKey, number>();
  for (const jot of jots) {
    const key = stageKeyOf(jot.enrollmentStage);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const total = jots.length;
  const stages: StageCount[] = STAGES.map((meta) => {
    const count = counts.get(meta.key) ?? 0;
    return {
      key: meta.key,
      label: meta.label,
      meaning: meta.meaning,
      tone: meta.tone,
      count,
      share: total ? count / total : 0,
      funnel: meta.funnel,
    };
  }).filter((s) => s.count > 0 || ALWAYS_SHOW.has(s.key));

  const enrolled = counts.get(ENROLLED) ?? 0;
  const failed = counts.get(FAILED) ?? 0;
  const resolved = enrolled + failed;

  const open = jots.filter((j) => !isTerminal(j.enrollmentStage));
  const openAges = open
    .map((j) => daysSince(j.submittedAt))
    .filter((d): d is number => d !== null);

  return {
    submitted: total,
    submittedThisMonth: jots.filter((j) => j.submittedAt.slice(0, 7) === thisMonth).length,
    stages,
    enrolled,
    failed,
    unstaged: counts.get(UNSTAGED) ?? 0,
    enrolledRateOfResolved: resolved ? enrolled / resolved : null,
    needsYou: jots.filter((j) => j.problems.length > 0 || j.requiredDocuments.length > 0).length,
    openProblems: jots.reduce((n, j) => n + j.problems.length, 0),
    requirementsDue: jots.filter((j) => j.requirementDue).length,
    stalled: open.filter((j) => (daysSince(j.submittedAt) ?? 0) >= STALL_DAYS).length,
    oldestOpenDays: openAges.length ? Math.max(...openAges) : null,
  };
}

/** Re-exported so the page does not need to know the sentinel values. */
export { stageMeta, STALL_DAYS };

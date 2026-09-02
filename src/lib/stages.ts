/**
 * Enrollment_Stage — the field the KPIs are built on.
 *
 * These five values are the ones in use in Zoho, confirmed by COQL against the
 * live JOTS module with the query below. The `is not null` half matters: a bare
 * `not in (...)` fills its page with the many null-stage historical records and
 * never reaches the rare non-null outliers, which is how `Awaiting Enrollment`
 * was missed on a first pass.
 *
 *   select Enrollment_Stage from JOTS
 *   where Enrollment_Stage is not null
 *     and Enrollment_Stage not in ('Enrolled', 'Failed to Enroll',
 *         'Ready to Enroll', 'Enrolling', 'Awaiting Enrollment')
 *
 * That returns nothing today. Re-run it if the funnel ever looks wrong; a value
 * added in Zoho lands in OTHER rather than breaking, but it will not be ordered
 * or explained until it is added here.
 *
 * `Enrollment_Stage` was created 2026-08-25 and back-filled only partly, so a
 * large body of historical forms still carry null. That is why UNSTAGED is a
 * real bucket and not an error case: dropping those rows would understate a
 * field agent's book, and folding them into "Ready to Enroll" would overstate
 * what the office has actually picked up.
 *
 * Pinned as exact strings because they go straight into a comparison against
 * Zoho's own picklist values, where a near-miss matches nothing rather than
 * erroring.
 */

export const READY = "Ready to Enroll";
export const AWAITING = "Awaiting Enrollment";
export const ENROLLING = "Enrolling";
export const ENROLLED = "Enrolled";
export const FAILED = "Failed to Enroll";

/** Sentinel for a form the office has not staged yet (Zoho null/empty). */
export const UNSTAGED = "__unstaged__";
/** Sentinel for a picklist value added in Zoho that this app has not been
 *  taught about. Shown rather than swallowed — a stage nobody can see is worse
 *  than one that is merely unlabelled. */
export const OTHER = "__other__";

export type StageKey =
  | typeof READY
  | typeof AWAITING
  | typeof ENROLLING
  | typeof ENROLLED
  | typeof FAILED
  | typeof UNSTAGED
  | typeof OTHER;

export type StageTone = "waiting" | "progress" | "done" | "failed" | "unknown";

interface StageMeta {
  key: StageKey;
  /** What the agent sees. Shorter than Zoho's label where the screen is tight. */
  label: string;
  /** One line telling the agent what it means for them. */
  meaning: string;
  tone: StageTone;
  /** Position in the funnel. Terminal and unstaged buckets sit outside it. */
  funnel: boolean;
}

/** Funnel order, then the buckets that sit outside the funnel. */
export const STAGES: StageMeta[] = [
  {
    key: UNSTAGED,
    label: "Not staged yet",
    meaning: "Submitted. The office has not picked it up yet.",
    tone: "unknown",
    funnel: false,
  },
  {
    key: READY,
    label: "Ready to enroll",
    meaning: "Validated and queued. Nothing needed from you.",
    tone: "waiting",
    funnel: true,
  },
  {
    // Ordered after "Ready to enroll" on the reading that it means blocked
    // rather than merely queued — the one record carrying it also carries an
    // outstanding required document and a due date. That is one record, so the
    // order here is a considered guess and not a fact; confirm it with the
    // office before anyone reads the funnel as a sequence.
    key: AWAITING,
    label: "Awaiting enrollment",
    meaning: "Held. Usually waiting on a document or an answer.",
    tone: "waiting",
    funnel: true,
  },
  {
    key: ENROLLING,
    label: "Enrolling",
    meaning: "The office is on the exchange with it now.",
    tone: "progress",
    funnel: true,
  },
  {
    key: ENROLLED,
    label: "Enrolled",
    meaning: "Coverage is in place.",
    tone: "done",
    funnel: true,
  },
  {
    key: FAILED,
    label: "Failed to enroll",
    meaning: "It did not go through. Expect the office to ask for something.",
    tone: "failed",
    funnel: false,
  },
  {
    key: OTHER,
    label: "Other stage",
    meaning: "A stage this app has not been taught about yet.",
    tone: "unknown",
    funnel: false,
  },
];

const KNOWN = new Set<string>([READY, AWAITING, ENROLLING, ENROLLED, FAILED]);

/** Map a raw Zoho value onto a bucket. Null, empty and whitespace are all
 *  unstaged; anything unrecognised lands in OTHER rather than disappearing. */
export function stageKeyOf(raw: string | null | undefined): StageKey {
  const v = (raw ?? "").trim();
  if (!v) return UNSTAGED;
  if (KNOWN.has(v)) return v as StageKey;
  return OTHER;
}

export function stageMeta(key: StageKey): StageMeta {
  return STAGES.find((s) => s.key === key) ?? STAGES[STAGES.length - 1];
}

/** Label for a raw Zoho value, for inline display. */
export function stageLabel(raw: string | null | undefined): string {
  const key = stageKeyOf(raw);
  // An unrecognised value is shown verbatim — more useful to the agent, and to
  // whoever has to add it to STAGES, than the word "Other".
  if (key === OTHER) return (raw ?? "").trim();
  return stageMeta(key).label;
}

/** Badge tone for a raw Zoho value. */
export function stageTone(raw: string | null | undefined): StageTone {
  return stageMeta(stageKeyOf(raw)).tone;
}

/** True when the stage means the form is finished, either way. */
export function isTerminal(raw: string | null | undefined): boolean {
  const k = stageKeyOf(raw);
  return k === ENROLLED || k === FAILED;
}

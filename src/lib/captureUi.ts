/**
 * Where the agent is in the application: open or closed, and which step.
 *
 * ── Why this is persisted at all ──────────────────────────────────────────
 * The application form is one route, and every tab change unmounts it. Holding
 * "the form is open, on step 4" in component state meant an agent who tapped
 * Quote to re-check a premium came back to the review gate, at step 1, with
 * their place gone — the form had effectively closed itself behind them. That
 * is not a small annoyance mid-enrollment with a client waiting.
 *
 * The draft itself already survives in sessionStorage. The agent's POSITION in
 * it has to survive the same way, or the draft outliving navigation is only
 * half the promise.
 *
 * ── Why it is keyed by draft id ───────────────────────────────────────────
 * Otherwise a new application would inherit the last one's position — opened,
 * on step 5, on a form with nothing in it. A mismatched id reads as "closed, at
 * the beginning", which is what a fresh application should be.
 *
 * Pure and import-free, like ssn.ts and coql.ts, so the recovery rules below
 * are testable without a browser.
 */

export interface CaptureUi {
  /** Which draft this position belongs to. */
  draftId: string;
  /** Is the form open for editing, rather than showing the summary? */
  editing: boolean;
  /** Zero-based step index. */
  step: number;
}

export function closedAt(draftId: string): CaptureUi {
  return { draftId, editing: false, step: 0 };
}

/**
 * Recover a saved position, or fall back to closed-at-the-beginning.
 *
 * Every failure mode lands on that fallback rather than throwing: corrupt
 * storage, a position from a different draft, a step index from a version of
 * the form with more steps than this one. None of those is worth an error
 * screen when "start at the top, not editing" is always a safe answer.
 */
export function readCaptureUi(
  raw: string | null,
  draftId: string,
  stepCount: number,
): CaptureUi {
  const fallback = closedAt(draftId);
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;

  const saved = parsed as Partial<CaptureUi>;
  // A position from another application tells us nothing about this one.
  if (saved.draftId !== draftId) return fallback;

  const step =
    typeof saved.step === "number" && Number.isFinite(saved.step)
      ? Math.min(Math.max(Math.trunc(saved.step), 0), Math.max(stepCount - 1, 0))
      : 0;

  return { draftId, editing: saved.editing === true, step };
}

export function serializeCaptureUi(ui: CaptureUi): string {
  return JSON.stringify({ draftId: ui.draftId, editing: ui.editing, step: ui.step });
}

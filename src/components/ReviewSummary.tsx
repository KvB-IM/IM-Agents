"use client";

import { AlertCircle } from "lucide-react";
import { Card } from "./ui";
import { buildSections } from "@/lib/reviewRows.ts";
import type { Row } from "@/lib/reviewRows.ts";
import type { CaptureDraft } from "@/lib/types";

/**
 * The whole application, laid out for confirmation.
 *
 * ── Why it shows everything ───────────────────────────────────────────────
 * The first version summarised: applicant, county, income, plan, twelve rows in
 * all. That is a receipt, not a review. An agent sitting with a client is doing
 * one specific job on this screen — reading the answers back and catching the
 * ones that are wrong — and a field that is not on the screen cannot be caught.
 * A transposed date of birth, or a sex set on the wrong dependent, is invisible
 * once submitted and costs a phone call and a correction to undo.
 *
 * So every captured answer appears, grouped in the order it was asked, and
 * anything left blank says so in amber rather than showing an empty cell that
 * reads as intentional. The count at the top is there because "did I miss
 * anything" should not require scrolling the whole thing.
 *
 * Each section jumps back to the step that owns it, so fixing what you find is
 * one tap rather than five taps of Back.
 *
 * The rows themselves are built in lib/reviewRows.ts — pure, and tested.
 */
export default function ReviewSummary({
  draft,
  onEdit,
}: {
  draft: CaptureDraft;
  onEdit: (step: number) => void;
}) {
  const sections = buildSections(draft);
  const unanswered = sections.flatMap((s) => s.rows).filter((r) => r.missing).length;

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-navy-900">
            Review everything
          </h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">
            Read it back to the client before submitting. This is exactly what the office
            receives.
          </p>
          {unanswered > 0 ? (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-warning/25">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <span>
                {unanswered} {unanswered === 1 ? "question is" : "questions are"} unanswered.
                The office will chase whatever is left blank — filling it now is faster than a
                phone call later.
              </span>
            </p>
          ) : null}
        </div>

        {sections.map((section) => (
          <section key={section.title}>
            <div className="flex items-baseline justify-between gap-3 border-t border-line bg-navy-50/60 px-4 py-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-navy-700">
                {section.title}
              </h3>
              <button
                type="button"
                onClick={() => onEdit(section.step)}
                className="tap -my-1 shrink-0 text-[12px] font-semibold text-navy-600 active:text-navy-900"
              >
                Edit
              </button>
            </div>
            <dl className="divide-y divide-line px-4">
              {section.rows.map((row, i) => (
                <RowLine key={`${row.label}-${i}`} row={row} />
              ))}
            </dl>
          </section>
        ))}
      </Card>
    </div>
  );
}

function RowLine({ row }: { row: Row }) {
  return (
    <div className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-[13px] text-muted">{row.label}</dt>
        <dd
          className={`text-right text-[13px] font-medium ${
            row.missing ? "text-warning" : "text-navy-900"
          }`}
        >
          {row.missing ? "Not answered" : row.value}
        </dd>
      </div>
      {row.warn ? (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-warning">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden />
          {row.warn}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { Check, Pill, Stethoscope } from "lucide-react";
import { statusLabel, type CoverageStatus } from "@/lib/cmsCoverage.ts";
import type { QuotedPlan } from "@/lib/types";
import { money, metalClass } from "@/lib/format";

/**
 * One quoted plan.
 *
 * The net premium is the headline, at the largest size on the card, because it
 * is the only number the client reacts to. The gross premium and the credit are
 * shown underneath so the agent can explain where the net came from — and so a
 * $0 net does not look like a bug.
 */
export interface CoverageItem {
  kind: "drug" | "provider";
  label: string;
  status: CoverageStatus;
}

export default function PlanCard({
  plan,
  selected,
  onSelect,
  className = "",
  coverage,
}: {
  plan: QuotedPlan;
  selected: boolean;
  onSelect: () => void;
  className?: string;
  /** Per-item coverage for the drugs and doctors the agent asked about. */
  coverage?: CoverageItem[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      /* `block`, NOT `w-full`. A <button> is inline-block, so it needs a display
         change to fill its line — but `w-full` means 100% of the PARENT, which
         with the caller\'s `mx-4` came to viewport + 32px. Every card hung off
         the right edge of a 375px screen, clipping the premium, and the whole
         page scrolled horizontally. A block element with margins fills what is
         left over, which is what was wanted. */
      className={`block rounded-2xl bg-white p-4 text-left ring-1 transition-shadow ${
        selected
          ? "ring-2 ring-navy-900 shadow-[0_2px_10px_rgba(11,26,51,0.12)]"
          : "ring-line active:bg-navy-50/50"
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${metalClass(plan.metalLevel)}`}
            >
              {plan.metalLevel}
            </span>
            {plan.planType ? (
              <span className="text-[11px] font-medium text-muted">{plan.planType}</span>
            ) : null}
            {plan.hsaEligible ? (
              <span className="text-[11px] font-medium text-success">HSA</span>
            ) : null}
          </div>
          <p
            className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-tight text-navy-900"
            title={plan.planName}
          >
            {plan.planName}
          </p>
          <p className="text-[13px] text-muted">{plan.carrier}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[22px] font-bold leading-none tracking-tight text-navy-900">
            {money(plan.netPremium)}
          </p>
          <p className="text-[11px] text-muted">/mo net</p>
          {selected ? (
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-navy-900">
              <Check size={13} strokeWidth={3} aria-hidden /> Selected
            </span>
          ) : null}
        </div>
      </div>

      {/* What this plan does with the client's own drugs and doctors.
          Placed above the money, because for someone on a biologic it is the
          deciding fact and the premium is secondary. */}
      {coverage && coverage.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {coverage.map((item) => (
            <li key={`${item.kind}-${item.label}`}>
              <CoverageBadge item={item} />
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px]">
        <div className="flex justify-between">
          <dt className="text-muted">Premium</dt>
          <dd className="font-medium text-navy-800">{money(plan.premium)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Tax credit</dt>
          <dd className="font-medium text-success">
            {plan.aptc > 0 ? `−${money(plan.aptc)}` : "—"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Deductible</dt>
          <dd className="font-medium text-navy-800">{money(plan.deductible)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted">Max OOP</dt>
          <dd className="font-medium text-navy-800">{money(plan.moop)}</dd>
        </div>
      </dl>

      {/* Cost shares, verbatim from the carrier.
          These were in every quote response and thrown away, which is a shame
          because they are the questions a client actually asks — "what do I
          pay to see my doctor" beats a deductible they will never meet. */}
      {/* One column on a phone, two from `sm`. Several of these values are
          sentences — "40% coinsurance after deductible" — and in a 2-column
          grid at 375px each wrapped to three lines and made the card twice as
          tall. Full width fits them on one line. */}
      {plan.primaryCare || plan.specialist || plan.genericRx ? (
        <dl className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[12px] sm:grid-cols-2">
          {plan.primaryCare ? (
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-muted">Doctor</dt>
              <dd className="text-right font-medium text-navy-800">{plan.primaryCare}</dd>
            </div>
          ) : null}
          {plan.specialist ? (
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-muted">Specialist</dt>
              <dd className="text-right font-medium text-navy-800">{plan.specialist}</dd>
            </div>
          ) : null}
          {plan.genericRx ? (
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-muted">Generic Rx</dt>
              <dd className="text-right font-medium text-navy-800">{plan.genericRx}</dd>
            </div>
          ) : null}
          {plan.urgentCare ? (
            <div className="flex justify-between gap-2">
              <dt className="shrink-0 text-muted">Urgent care</dt>
              <dd className="text-right font-medium text-navy-800">{plan.urgentCare}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* The carrier's own documents. Until the CMS drug and provider lookups
          are wired, the formulary and directory links ARE the answer to "is my
          drug covered" and "is my doctor in network" — an agent can open them
          at the table. `stopPropagation` so opening one does not also select
          the plan; `span role=link` because a real <a> cannot nest in the
          card's <button>. */}
      {plan.formularyUrl || plan.networkUrl || plan.sbcUrl ? (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[12px] font-semibold text-navy-600">
          {plan.networkUrl ? <DocLink href={plan.networkUrl} label="Find a doctor" /> : null}
          {plan.formularyUrl ? <DocLink href={plan.formularyUrl} label="Drug list" /> : null}
          {plan.sbcUrl ? <DocLink href={plan.sbcUrl} label="Benefits (SBC)" /> : null}
        </div>
      ) : null}
    </button>
  );
}

/**
 * A carrier document link inside the plan card.
 *
 * The card is a <button>, so a nested <a> would be invalid HTML and browsers
 * handle it inconsistently. This is a span with link semantics that opens the
 * URL itself, and stops the click from bubbling into "select this plan".
 */
/**
 * One drug or doctor against this plan.
 *
 * Four states, deliberately: "Not published" is NOT "not covered". CMS answers
 * from files the issuer publishes, and a plan that published nothing has not
 * excluded anything — telling a client their medication is off a formulary on
 * that basis would be a wrong answer with real consequences. "Generic only"
 * stays separate too: the brand is off the list but its generic is on it, which
 * is a conversation with the prescriber rather than a tick.
 */
function CoverageBadge({ item }: { item: CoverageItem }) {
  const tone = {
    covered: "bg-success/10 text-success ring-success/25",
    generic: "bg-gold-100 text-gold-600 ring-gold-500/30",
    not_covered: "bg-error/10 text-error ring-error/25",
    unknown: "bg-navy-50 text-muted ring-line",
  }[item.status];

  const mark = {
    covered: "✓",
    generic: "≈",
    not_covered: "✕",
    unknown: "?",
  }[item.status];

  return (
    <span
      className={`inline-flex max-w-[15rem] items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tone}`}
      title={`${item.label} — ${statusLabel(item.status)}`}
    >
      {item.kind === "drug" ? (
        <Pill size={11} className="shrink-0" aria-hidden />
      ) : (
        <Stethoscope size={11} className="shrink-0" aria-hidden />
      )}
      <span className="truncate">{item.label}</span>
      <span aria-hidden>{mark}</span>
      <span className="sr-only">{statusLabel(item.status)}</span>
    </span>
  );
}

function DocLink({ href, label }: { href: string; label: string }) {
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        window.open(href, "_blank", "noopener,noreferrer");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
        }
      }}
      className="tap-none underline decoration-navy-300 underline-offset-2 active:text-navy-900"
    >
      {label}
    </span>
  );
}

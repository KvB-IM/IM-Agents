"use client";

import { Check } from "lucide-react";
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
export default function PlanCard({
  plan,
  selected,
  onSelect,
  className = "",
}: {
  plan: QuotedPlan;
  selected: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl bg-white p-4 text-left ring-1 transition-shadow ${
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
    </button>
  );
}

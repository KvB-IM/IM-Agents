"use client";

import { useEffect, useState } from "react";
import { useDraft } from "@/components/DraftContext";
import PlanCard, { type CoverageItem } from "@/components/PlanCard";
import CoverageCheck, {
  type CheckedDrug,
  type CheckedProvider,
} from "@/components/CoverageCheck";
import {
  indexCoverage,
  statusFor,
  combineStatuses,
  unreliablePlans,
  CANARY_RXCUIS,
  type CoverageRow,
  type CoverageStatus,
} from "@/lib/cmsCoverage.ts";
import { Select, Empty, Inset } from "@/components/ui";
import { monthYear, money } from "@/lib/format";
import type { QuotedPlan } from "@/lib/types";

/**
 * Step 2 of Enroll: the plan list.
 *
 * Owns its own filters and the optional CMS drug/doctor coverage check. The
 * plan list itself is passed in — it belongs to the quote that produced it,
 * which the stepper runs from the Household step's inputs. Selecting a card
 * writes `selectedPlan` on the draft; the footer's Next is what advances.
 */
export default function PlansStep({ plans }: { plans: QuotedPlan[] }) {
  const { draft, patch } = useDraft();
  const primaryName = (() => {
    const p = draft.people.find((x) => x.relation === "primary") ?? draft.people[0];
    return [p?.firstName, p?.lastName].filter(Boolean).join(" ");
  })();

  /* Two filters, both "" for no filter. Necessary rather than decorative: the
   * quote used to cap at 40 plans and now returns everything the market has —
   * 85 for a Maricopa household — and 85 cards sorted by premium is not a list
   * anyone scrolls to the Gold plans through. */
  const [metalFilter, setMetalFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");

  /* Drug and provider coverage, from CMS. Entirely optional: every failure
   * path leaves the plan list exactly as it was. */
  const [checkedDrugs, setCheckedDrugs] = useState<CheckedDrug[]>([]);
  const [checkedProviders, setCheckedProviders] = useState<CheckedProvider[]>([]);
  const [coverageRows, setCoverageRows] = useState<{
    drugs: CoverageRow[];
    providers: CoverageRow[];
  }>({ drugs: [], providers: [] });
  const [coverageBusy, setCoverageBusy] = useState(false);
  /* Which plan year CMS actually answered from. Differs from the quote's own
   * year when CMS has not published it yet — normal for a January effective
   * date during open enrollment. */
  const [coverageYearUsed, setCoverageYearUsed] = useState<number | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);
  /* "Only plans that work for this client." Off by default — it hides plans,
   * and a filter that hides plans has to be the agent's choice. */
  const [coveredOnly, setCoveredOnly] = useState(false);

  /* Metal levels present in this quote, in coverage order rather than
   * alphabetical. */
  const metalLevels = (() => {
    if (!plans) return [] as string[];
    const order = ["Bronze", "Expanded Bronze", "Silver", "Gold", "Platinum", "Catastrophic"];
    return [...new Set(plans.map((p) => p.metalLevel).filter(Boolean))].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
  })();

  /* Carriers, alphabetical. A select rather than chips: seven issuers with
   * names like "Ambetter from Arizona Complete Health" do not fit on a row of
   * pills at 375px, and the metal chips beside them would stop being
   * scannable. */
  const carriers = plans
    ? [...new Set(plans.map((p) => p.carrier).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    : [];

  /**
   * Fetch coverage whenever the client's drug or doctor list changes.
   *
   * Against EVERY quoted plan, not just the filtered ones: the point of the
   * question is to find which plans work, and filtering first would hide the
   * answer. Batched ten plan ids per call inside the API route — 85 plans is
   * nine sequential calls, about five seconds, however many medications are on
   * the list.
   */
  useEffect(() => {
    const rxcuis = checkedDrugs.map((d) => d.rxcui);
    const npis = checkedProviders.map((p) => p.npi);
    if (!plans || plans.length === 0 || (rxcuis.length === 0 && npis.length === 0)) {
      setCoverageRows({ drugs: [], providers: [] });
      setCoverageError(null);
      setCoverageYearUsed(null);
      return;
    }

    let cancelled = false;
    setCoverageBusy(true);
    setCoverageError(null);

    (async () => {
      try {
        const res = await fetch("/api/cms/coverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planIds: plans.map((p) => p.planHiosId).filter(Boolean),
            /* The canaries ride along, so each plan's formulary can be
               sanity-checked. They cost no extra call. */
            rxcuis: rxcuis.length > 0 ? [...new Set([...rxcuis, ...CANARY_RXCUIS])] : [],
            npis,
            year: Number(draft.requestedEffective.slice(0, 4)),
          }),
        });
        const data = (await res.json()) as {
          drugs?: CoverageRow[];
          providers?: CoverageRow[];
          yearUsed?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setCoverageError(data.error ?? "The coverage lookup failed.");
          setCoverageRows({ drugs: [], providers: [] });
          return;
        }
        setCoverageRows({ drugs: data.drugs ?? [], providers: data.providers ?? [] });
        setCoverageYearUsed(data.yearUsed ?? null);
      } catch {
        if (!cancelled) setCoverageError("No connection, so coverage could not be checked.");
      } finally {
        if (!cancelled) setCoverageBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plans, checkedDrugs, checkedProviders, draft.requestedEffective]);

  const drugIndex = indexCoverage(coverageRows.drugs);
  const providerIndex = indexCoverage(coverageRows.providers);
  const checking = checkedDrugs.length + checkedProviders.length > 0;

  /**
   * Did ANY plan in this market publish usable data?
   *
   * Not per-plan but market-wide, because that is how the gap actually
   * appears: in Georgia all five issuers return DataNotProvided for every
   * provider, so the answer is 97 identical grey badges. Said once at the top
   * it is useful; repeated on every card it is noise.
   */
  const anyAnswer = (index: Map<string, Map<string, CoverageStatus>>, itemIds: string[]) =>
    itemIds.length > 0 &&
    (plans ?? []).some((p) =>
      itemIds.some((id) => {
        const status = index.get(p.planHiosId)?.get(id);
        return status !== undefined && status !== "unknown";
      }),
    );

  const noDrugData =
    checkedDrugs.length > 0 &&
    !coverageBusy &&
    coverageRows.drugs.length > 0 &&
    !anyAnswer(indexCoverage(coverageRows.drugs), checkedDrugs.map((d) => d.rxcui));
  const noProviderData =
    checkedProviders.length > 0 &&
    !coverageBusy &&
    coverageRows.providers.length > 0 &&
    !anyAnswer(indexCoverage(coverageRows.providers), checkedProviders.map((p) => p.npi));

  /* Plans whose own formulary is too sparse to quote a refusal from. */
  const untrusted = unreliablePlans(
    drugIndex,
    (plans ?? []).map((p) => p.planHiosId),
  );

  /** The badges for one plan, in the order the agent added them. */
  const coverageFor = (planHiosId: string): CoverageItem[] =>
    checking
      ? [
          ...checkedDrugs.map((d) => {
            const status = statusFor(drugIndex, planHiosId, d.rxcui);
            return {
              kind: "drug" as const,
              label: d.label,
              /* A refusal from a plan that does not list the commonest
                 generics is not evidence about this client's drug. */
              status:
                untrusted.has(planHiosId) && status === "not_covered"
                  ? ("unreliable" as CoverageStatus)
                  : status,
            };
          }),
          ...checkedProviders.map((pr) => ({
            kind: "provider" as const,
            label: pr.label,
            status: statusFor(providerIndex, planHiosId, pr.npi),
          })),
        ]
      : [];

  /** One verdict per plan, for the "works for this client" filter. */
  const verdictFor = (planHiosId: string): CoverageStatus =>
    combineStatuses(coverageFor(planHiosId).map((c) => c.status));

  const shown = (plans ?? []).filter(
    (p) =>
      (!metalFilter || p.metalLevel === metalFilter) &&
      (!carrierFilter || p.carrier === carrierFilter) &&
      /* "Covered" only, and NOT "unknown" — see combineStatuses. A plan that
         never published its formulary has not been shown to work for this
         client, so it does not belong in a list that claims it does. */
      (!coveredOnly || !checking || verdictFor(p.planHiosId) === "covered"),
  );

  const filtered = Boolean(metalFilter || carrierFilter || (coveredOnly && checking));
  const clearFilters = () => {
    setMetalFilter("");
    setCarrierFilter("");
    setCoveredOnly(false);
  };


  return (
    <div className="space-y-4">
      <Inset>
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-navy-900">
          {primaryName ? `Plans for ${primaryName}` : "Plans"}
        </h1>
        {/* The inputs that produced this list, so they can be sanity-checked
            without going back for them. A quote run on the wrong household
            size or income looks completely plausible on its own. */}
        <p className="mt-0.5 text-[13px] leading-snug text-muted">
          {[
            `${draft.people.length} ${draft.people.length === 1 ? "person" : "people"}`,
            draft.county ? `${draft.county.name}, ${draft.county.state}` : null,
            monthYear(draft.requestedEffective),
            draft.householdIncome !== null ? money(draft.householdIncome) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </Inset>

        {/* Optional, and it degrades to nothing: unconfigured key, expired
            key or CMS down all leave the plan list untouched. */}
        {plans.length > 0 ? (
          <CoverageCheck
            year={Number(draft.requestedEffective.slice(0, 4))}
            zip={draft.zip}
            drugs={checkedDrugs}
            providers={checkedProviders}
            onChange={({ drugs, providers }) => {
              setCheckedDrugs(drugs);
              setCheckedProviders(providers);
            }}
            busy={coverageBusy}
            error={coverageError}
            yearUsed={coverageYearUsed}
            noDrugData={noDrugData}
            noProviderData={noProviderData}
          />
        ) : null}

        {plans.length === 0 ? (
          <Empty
            title="No plans returned"
            body="Check the county and the effective date. Off-exchange plans are not included in this quote."
          />
        ) : (
          <section className="space-y-3">
            {/* Both dropdowns, not chips.
                A scrolling row of pills hides its own overflow on a phone —
                the Gold chip was off the right edge of a 375px screen, which
                is the same problem as the 40-plan cap: an option nobody can
                see. A select shows every choice in one tap. */}
            {metalLevels.length > 1 || carriers.length > 1 || checking ? (
              <div className="space-y-2 px-4">
                {metalLevels.length > 1 ? (
                  <Select
                    value={metalFilter}
                    onChange={(e) => setMetalFilter(e.target.value)}
                    aria-label="Filter by metal level"
                  >
                    <option value="">All metal levels</option>
                    {metalLevels.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </Select>
                ) : null}

                {carriers.length > 1 ? (
                  <Select
                    value={carrierFilter}
                    onChange={(e) => setCarrierFilter(e.target.value)}
                    aria-label="Filter by carrier"
                  >
                    <option value="">All carriers</option>
                    {carriers.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                ) : null}

                {/* Only offered once something is being checked, and only
                    while the answers are in — a toggle that hides plans on
                    incomplete data is worse than no toggle. */}
                {checking && !coverageBusy && !coverageError ? (
                  <button
                    type="button"
                    onClick={() => setCoveredOnly((v) => !v)}
                    aria-pressed={coveredOnly}
                    className={`tap w-full rounded-xl px-3 text-[14px] font-medium transition-colors ${
                      coveredOnly
                        ? "bg-navy-900 text-white"
                        : "bg-white text-navy-700 ring-1 ring-line active:bg-navy-50"
                    }`}
                  >
                    {coveredOnly ? "Showing only plans that cover all of it" : "Only plans that cover all of it"}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-baseline justify-between px-4">
              <h2 className="text-[15px] font-semibold text-navy-900">
                {filtered ? `${shown.length} of ${plans.length} plans` : `${plans.length} plans`}
              </h2>
              <span className="text-[12px] text-muted">cheapest net first</span>
            </div>

            {/* The two filters are independent, so a combination can honestly
                match nothing — Oscar has no plain Bronze plan for this
                household. Say which pair is empty and offer the way out. */}
            {shown.length === 0 ? (
              <div className="mx-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
                <p className="text-[15px] font-semibold text-navy-900">No plans match</p>
                <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted">
                  {carrierFilter && metalFilter
                    ? `${carrierFilter} has no ${metalFilter} plan for this household.`
                    : "Nothing matches that filter."}
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="tap mt-3 text-[13px] font-semibold text-navy-700 active:text-navy-900"
                >
                  Clear filters
                </button>
              </div>
            ) : null}

            {/* Padding on the CONTAINER, not margins on the cards: a `w-full`
                card plus `mx-4` measures wider than the viewport. */}
            <div className="space-y-3 px-4 sm:px-0">
              {shown.map((plan) => (
              <PlanCard
                key={plan.planId}
                plan={plan}
                selected={draft.selectedPlan?.planId === plan.planId}
                onSelect={() => patch({ selectedPlan: plan })}
                coverage={coverageFor(plan.planHiosId)}
              />
              ))}
            </div>

          </section>
        )}
    </div>
  );
}

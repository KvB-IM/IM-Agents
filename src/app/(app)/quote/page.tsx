"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Search, AlertCircle, ArrowRight, X } from "lucide-react";
import { useDraft } from "@/components/DraftContext";
import PersonEditor from "@/components/PersonEditor";
import PlanCard from "@/components/PlanCard";
import { Card, CardHeader, Field, TextInput, Select, Button, ActionBar, Empty, Inset } from "@/components/ui";
import { effectiveDateOptions, ageAt } from "@/lib/age";
import { monthYear } from "@/lib/format";
import type { County, QuotedPlan } from "@/lib/types";

/**
 * The quote flow: where, who, how much, then plans.
 *
 * One scrolling page rather than a wizard. An agent runs this at a kitchen
 * table while the client changes their mind about who is on the policy, so
 * every input stays reachable — a four-step wizard would mean going back two
 * steps to add a child and losing the plan list.
 */
export default function QuotePage() {
  const router = useRouter();
  const { draft, patch, patchPerson, addPerson, removePerson, reset, loaded } = useDraft();

  const primaryName = (() => {
    const p = draft.people.find((x) => x.relation === "primary") ?? draft.people[0];
    return [p?.firstName, p?.lastName].filter(Boolean).join(" ");
  })();

  const [counties, setCounties] = useState<County[]>([]);
  const [countyLoading, setCountyLoading] = useState(false);
  const [plans, setPlans] = useState<QuotedPlan[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  /* Two filters, both "" for no filter. Necessary rather than decorative: the
   * quote used to cap at 40 plans and now returns everything the market has —
   * 85 for a Maricopa household — and 85 cards sorted by premium is not a list
   * anyone scrolls to the Gold plans through. */
  const [metalFilter, setMetalFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");

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

  const shown = (plans ?? []).filter(
    (p) =>
      (!metalFilter || p.metalLevel === metalFilter) &&
      (!carrierFilter || p.carrier === carrierFilter),
  );

  const filtered = Boolean(metalFilter || carrierFilter);
  const clearFilters = () => {
    setMetalFilter("");
    setCarrierFilter("");
  };

  /**
   * Is there a client's work sitting on this page?
   *
   * There was no way to put a quote down. An agent who resumed one client's
   * application and then needed to quote somebody else had that first client's
   * ZIP, household and plan still loaded, with nothing to clear it — the only
   * escape was closing the browser tab, which is also how you lose the draft.
   */
  const hasWork = Boolean(
    draft.zip ||
      draft.selectedPlan ||
      draft.people.some((p) => p.firstName || p.lastName || p.dateOfBirth),
  );

  // ── County lookup ────────────────────────────────────────────────────────
  // Fires as soon as the ZIP is five digits. A ZIP can span several counties
  // and quoting needs a single FIPS code, so this cannot be skipped.
  useEffect(() => {
    if (!/^\d{5}$/.test(draft.zip)) {
      setCounties([]);
      return;
    }
    let cancelled = false;
    setCountyLoading(true);
    fetch(`/api/hs/counties?zip_code=${draft.zip}`)
      .then((r) => r.json())
      .then((d: { counties?: County[]; error?: string }) => {
        if (cancelled) return;
        const list = d.counties ?? [];
        setCounties(list);
        // Only one county: pick it, and never make the agent tap a list of one.
        if (list.length === 1) patch({ county: list[0] });
      })
      .catch(() => {
        if (!cancelled) setCounties([]);
      })
      .finally(() => {
        if (!cancelled) setCountyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.zip, patch]);

  const covered = draft.people.filter((p) => p.seekingCoverage);
  const missingDob = covered.filter((p) => ageAt(p.dateOfBirth, draft.requestedEffective) === null);
  const canQuote =
    Boolean(draft.county?.fipsCode) && covered.length > 0 && missingDob.length === 0;

  const runQuote = useCallback(async () => {
    setError(null);
    setQuoting(true);
    setPlans(null);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip_code: draft.zip,
          fips_code: draft.county?.fipsCode,
          state: draft.county?.state,
          household_size: draft.householdSize ?? covered.length,
          annual_income: draft.householdIncome,
          effective_date: draft.requestedEffective,
          applicants: covered.map((p) => ({
            age: ageAt(p.dateOfBirth, draft.requestedEffective),
            uses_tobacco: p.tobacco,
          })),
        }),
      });
      const data = (await res.json()) as { plans?: QuotedPlan[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "The quote could not be run.");
        return;
      }
      setPlans(data.plans ?? []);
    } catch {
      setError("No connection. The quote needs signal — the application does not.");
    } finally {
      setQuoting(false);
    }
  }, [draft, covered]);

  if (!loaded) return null;

  return (
    <div className="space-y-4">
      <Inset>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] font-bold tracking-tight text-navy-900">Run a quote</h1>
            <p className="mt-0.5 text-[13px] text-muted">
              {primaryName
                ? `For ${primaryName} · ${monthYear(draft.requestedEffective)} effective`
                : `ACA on-exchange, ${monthYear(draft.requestedEffective)} effective.`}
            </p>
          </div>
          {hasWork ? (
            <button
              type="button"
              onClick={() => setConfirmNew(true)}
              aria-label="Close this quote and start a new one"
              className="tap -mr-1 -mt-1 flex w-10 shrink-0 items-center justify-center rounded-lg text-muted active:bg-navy-50"
            >
              <X size={20} aria-hidden />
            </button>
          ) : null}
        </div>

        {/* Two taps, and it names the client — the quote and the application
            are one draft, so clearing this clears both. */}
        {confirmNew ? (
          <div className="mt-3 rounded-xl bg-error/5 px-3.5 py-3 ring-1 ring-error/20">
            <p className="text-[13px] font-medium text-navy-900">Close this quote?</p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              Everything captured for {primaryName || "this client"} is cleared from this device,
              including anything already typed into the application. It cannot be recovered.
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmNew(false)}
                className="!w-auto flex-1"
              >
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  reset();
                  setPlans(null);
                  setError(null);
                  setConfirmNew(false);
                }}
                className="!w-auto flex-1"
              >
                Start a new quote
              </Button>
            </div>
          </div>
        ) : null}
      </Inset>

      {/* ── Where ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Where they live" hint="Rates are set by county, not by ZIP." />
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ZIP code">
              <TextInput
                value={draft.zip}
                onChange={(e) => {
                  const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
                  patch({ zip, county: null });
                }}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="85201"
              />
            </Field>
            <Field label="Effective date">
              <Select
                value={draft.requestedEffective}
                onChange={(e) => patch({ requestedEffective: e.target.value })}
              >
                {effectiveDateOptions(4).map((d) => (
                  <option key={d} value={d}>
                    {monthYear(d)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {countyLoading ? (
            <p className="text-[13px] text-muted">Looking up counties…</p>
          ) : counties.length > 1 ? (
            <Field label="County" hint="This ZIP spans more than one county.">
              <Select
                value={draft.county?.fipsCode ?? ""}
                onChange={(e) =>
                  patch({ county: counties.find((c) => c.fipsCode === e.target.value) ?? null })
                }
              >
                <option value="">Select a county…</option>
                {counties.map((c) => (
                  <option key={c.fipsCode} value={c.fipsCode}>
                    {c.name} County, {c.state}
                  </option>
                ))}
              </Select>
            </Field>
          ) : draft.county ? (
            <p className="text-[13px] text-muted">
              {draft.county.name} County, {draft.county.state}
              <span className="text-muted/60"> · FIPS {draft.county.fipsCode}</span>
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── Who ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Who needs coverage"
          hint="Dates of birth, not ages — the application needs the date."
        />
        <div>
          {draft.people.map((person) => (
            <PersonEditor
              key={person.key}
              person={person}
              effectiveDate={draft.requestedEffective}
              onChange={(p) => patchPerson(person.key, p)}
              onRemove={() => removePerson(person.key)}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-4">
          <Button variant="secondary" onClick={() => addPerson("spouse")}>
            <UserPlus size={16} aria-hidden /> Spouse
          </Button>
          <Button variant="secondary" onClick={() => addPerson("child")}>
            <UserPlus size={16} aria-hidden /> Child
          </Button>
        </div>
      </Card>

      {/* ── Income ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Household and income"
          hint="Annual household income drives the tax credit. Estimate it now; correct it on the application."
        />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Household size" hint="Everyone on the tax return.">
            <TextInput
              value={draft.householdSize ?? ""}
              onChange={(e) =>
                patch({ householdSize: e.target.value === "" ? null : Number(e.target.value) })
              }
              inputMode="numeric"
              placeholder={String(covered.length || 1)}
            />
          </Field>
          <Field label="Annual income">
            <TextInput
              value={draft.householdIncome ?? ""}
              onChange={(e) =>
                patch({ householdIncome: e.target.value === "" ? null : Number(e.target.value) })
              }
              inputMode="numeric"
              placeholder="48000"
            />
          </Field>
        </div>
      </Card>

      {/* ── Run ────────────────────────────────────────────────────────── */}
      {missingDob.length > 0 ? (
        <p className="flex items-start gap-2 px-4 text-[13px] text-warning">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {missingDob.length} {missingDob.length === 1 ? "person needs" : "people need"} a date of
          birth before this can be quoted.
        </p>
      ) : null}

      <Inset>
        <Button onClick={runQuote} disabled={!canQuote || quoting}>
          <Search size={17} aria-hidden />
          {quoting ? "Quoting…" : plans ? "Re-run quote" : "See plans"}
        </Button>
      </Inset>

      {error ? (
        <p className="mx-4 flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      {plans ? (
        plans.length === 0 ? (
          <Empty
            title="No plans returned"
            body="Check the county and the effective date. Off-exchange plans are not included in this quote."
          />
        ) : (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between px-4">
              <h2 className="text-[15px] font-semibold text-navy-900">
                {filtered ? `${shown.length} of ${plans.length} plans` : `${plans.length} plans`}
              </h2>
              <span className="text-[12px] text-muted">cheapest net first</span>
            </div>

            {/* Metal as chips — short, and scannable at a glance. Carrier as a
                select, because the names are far too long for pills. Only the
                levels and carriers this household actually has: an empty
                "Platinum" option is a dead end. */}
            {metalLevels.length > 1 || carriers.length > 1 ? (
              <div className="space-y-2 px-4">
                {metalLevels.length > 1 ? (
                  <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                    {["", ...metalLevels].map((level) => (
                      <button
                        key={level || "all"}
                        type="button"
                        onClick={() => setMetalFilter(level)}
                        aria-pressed={metalFilter === level}
                        className={`tap shrink-0 rounded-full px-3.5 text-[13px] font-semibold transition-colors ${
                          metalFilter === level
                            ? "bg-navy-900 text-white"
                            : "bg-white text-navy-700 ring-1 ring-line active:bg-navy-50"
                        }`}
                      >
                        {level || "All levels"}
                      </button>
                    ))}
                  </div>
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
              </div>
            ) : null}

            {/* The two filters are independent, so a combination can honestly
                match nothing — Cigna has no Gold plan for this household. Say
                which combination is empty and offer the way out, rather than
                rendering a blank list. */}
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

            {shown.map((plan) => (
              <PlanCard
                className="mx-4 sm:mx-0"
                key={plan.planId}
                plan={plan}
                selected={draft.selectedPlan?.planId === plan.planId}
                onSelect={() => patch({ selectedPlan: plan })}
              />
            ))}

            {draft.selectedPlan ? (
              <ActionBar>
                {/* Names the client. A quote page reached with a draft already
                    in progress otherwise offers "Continue to application" for
                    whoever that draft belongs to, with nothing saying so. */}
                <Button onClick={() => router.push("/capture?start=1")}>
                  {primaryName
                    ? `Continue ${primaryName}'s application`
                    : "Continue to application"}
                  <ArrowRight size={17} aria-hidden />
                </Button>
              </ActionBar>
            ) : null}
          </section>
        )
      ) : null}
    </div>
  );
}

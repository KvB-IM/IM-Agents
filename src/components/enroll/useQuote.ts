"use client";

import { useCallback, useState } from "react";
import { ageAt } from "@/lib/age";
import type { CaptureDraft, QuotedPlan } from "@/lib/types";

/**
 * Running a quote, as a hook the Enroll stepper owns.
 *
 * `plans` is deliberately component state, not part of the draft: a list of
 * 85 plan objects is a cache of an upstream call, not something captured, and
 * the inputs that produced it live in the draft already. A resumed session has
 * no plans and re-runs the quote from those inputs — see the Plans step.
 */
export function useQuote(draft: CaptureDraft) {
  const [plans, setPlans] = useState<QuotedPlan[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Returns true when a plan list came back, so the caller can advance. */
  const runQuote = useCallback(async (): Promise<boolean> => {
    const covered = draft.people.filter((p) => p.seekingCoverage);
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
        return false;
      }
      setPlans(data.plans ?? []);
      return true;
    } catch {
      setError("No connection. The quote needs signal — the application does not.");
      return false;
    } finally {
      setQuoting(false);
    }
  }, [draft]);

  return { plans, quoting, error, runQuote };
}

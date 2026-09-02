import { NextRequest, NextResponse } from "next/server";
import { hsFetch, hsConfigured, HealthSherpaUpstreamError } from "@/lib/healthsherpa";
import { fixturePlans } from "@/lib/fixtures";
import type { QuotedPlan } from "@/lib/types";

/**
 * POST /api/quotes → HealthSherpa POST /v1/quotes
 *
 * Ported from IM-Website/src/app/api/hs/quotes/route.ts, which is working in
 * production. Accepts a narrow, validated payload from our own frontend and
 * constructs the canonical HealthSherpa QuoteRequest server-side; never
 * forwards arbitrary client JSON upstream.
 *
 * One difference from the website's version: the field app captures dates of
 * birth, and ages arrive here already derived at the effective date (see
 * lib/age.ts). Ages are still what HealthSherpa rates on.
 */

interface ApplicantPayload {
  age?: unknown;
  uses_tobacco?: unknown;
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("Request body must be JSON.");
  }

  const zip = typeof body.zip_code === "string" ? body.zip_code : "";
  const fips = typeof body.fips_code === "string" ? body.fips_code : "";
  const state = typeof body.state === "string" ? body.state.toUpperCase() : "";
  if (!/^\d{5}$/.test(zip)) return bad("zip_code must be five digits.");
  if (!/^\d{5}$/.test(fips)) return bad("fips_code must be five digits. Look the county up first.");
  if (!/^[A-Z]{2}$/.test(state)) return bad("state must be a two-letter code.");

  const householdSize = Number(body.household_size);
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 20) {
    return bad("household_size must be a whole number of at least 1.");
  }

  const rawApplicants = Array.isArray(body.applicants) ? (body.applicants as ApplicantPayload[]) : [];
  if (rawApplicants.length < 1 || rawApplicants.length > 12) {
    return bad("applicants must contain between 1 and 12 people.");
  }

  // Relationships are positional: first applicant primary, first additional
  // adult spouse, everyone else dependent. Same rule as the website route.
  let spouseAssigned = false;
  const applicants = [];
  for (let i = 0; i < rawApplicants.length; i++) {
    const age = Number(rawApplicants[i]?.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) {
      return bad(`applicants[${i}].age must be a whole number between 0 and 120. Check the date of birth.`);
    }
    let relationship: "primary" | "spouse" | "dependent" = "dependent";
    if (i === 0) relationship = "primary";
    else if (!spouseAssigned && age >= 18) {
      relationship = "spouse";
      spouseAssigned = true;
    }
    applicants.push({
      member_id: `applicant-${i + 1}`,
      age,
      relationship,
      uses_tobacco: rawApplicants[i]?.uses_tobacco === true,
    });
  }

  const annualIncome =
    body.annual_income === undefined || body.annual_income === null || body.annual_income === ""
      ? undefined
      : Number(body.annual_income);
  if (annualIncome !== undefined && (!Number.isFinite(annualIncome) || annualIncome < 0)) {
    return bad("annual_income must be a non-negative number.");
  }

  const effectiveDate = typeof body.effective_date === "string" ? body.effective_date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return bad("effective_date must be formatted YYYY-MM-DD.");
  }
  const planYear = Number(effectiveDate.slice(0, 4));

  // ── Fixture mode ─────────────────────────────────────────────────────────
  // With no key configured, serve plans shaped like the real response so the
  // UI works on an iPad with no signal and no account.
  if (!hsConfigured()) {
    const totalAge = applicants.reduce((n, a) => n + a.age, 0);
    return NextResponse.json({
      plans: fixturePlans(householdSize, annualIncome ?? null, totalAge),
      fixture: true,
    });
  }

  const quoteRequest = {
    context: {
      product: "aca",
      exchange: "on_exchange",
      coverage_family: "medical",
      coverage_type: "medical",
      plan_year: planYear,
    },
    location: { zip_code: zip, fips_code: fips, state },
    household: {
      household_size: householdSize,
      ...(annualIncome !== undefined ? { annual_income: annualIncome } : {}),
      effective_date: effectiveDate,
      applicants,
    },
    sort: { field: "premium", direction: "asc" },
    page: { number: 1, size: 40 },
  };

  try {
    const data = (await hsFetch("/v1/quotes", {
      method: "POST",
      body: JSON.stringify(quoteRequest),
    })) as { plans?: Array<Record<string, unknown>> };

    const plans: QuotedPlan[] = (data.plans ?? []).map((p) => {
      const premium = Number(p.premium ?? 0);
      const aptc = Number(p.applied_aptc ?? p.aptc ?? 0);
      return {
        planId: String(p.id ?? p.plan_id ?? ""),
        planName: String(p.name ?? p.plan_name ?? ""),
        carrier: String(p.carrier_name ?? p.carrier ?? ""),
        metalLevel: String(p.metal_level ?? ""),
        planHiosId: String(p.hios_plan_id ?? p.plan_hios_id ?? ""),
        carrierHiosId: String(p.hios_issuer_id ?? p.carrier_hios_id ?? ""),
        premium,
        aptc,
        netPremium: Number(p.premium_with_credit ?? Math.max(0, premium - aptc)),
        deductible: p.deductible === undefined ? null : Number(p.deductible),
        moop: p.max_out_of_pocket === undefined ? null : Number(p.max_out_of_pocket),
        planType: String(p.plan_type ?? ""),
        hsaEligible: p.hsa_eligible === true,
      };
    });

    return NextResponse.json({ plans, fixture: false });
  } catch (err) {
    if (err instanceof HealthSherpaUpstreamError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status === 429 ? 429 : 502 });
    }
    return NextResponse.json({ error: "Quote lookup failed. Please try again." }, { status: 500 });
  }
}

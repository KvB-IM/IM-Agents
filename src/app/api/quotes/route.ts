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

/* ── HealthSherpa's plan shape ─────────────────────────────────────────────
 * Written against a real response, not the docs. Two things the first pass got
 * wrong by guessing flat field names: the plan is NESTED under `pricing`,
 * `details` and `issuer`, and every monetary value is a STRING. Reading
 * `p.premium` gave undefined, `Number(undefined)` gave NaN, and the UI
 * rendered a page of $0 plans that looked plausible enough to ship.
 */
interface HsPlan {
  plan_id?: string;
  name?: string;
  display_name?: string;
  api_enrollable?: boolean;
  issuer?: {
    issuer_id?: string;
    name?: string;
    customer_service_phone?: string | null;
  };
  network?: { network_id?: string; name?: string; type?: string; network_url?: string | null };
  pricing?: {
    gross_premium?: string;
    net_premium?: string;
    subsidy_applied?: string;
    max_aptc?: string | null;
  };
  documents?: {
    sbc_url?: string | null;
    formulary_url?: string | null;
    network_url?: string | null;
    brochure_url?: string | null;
  };
  availability?: { rating_area?: string | null };
  release?: { release_id?: string };
  details?: {
    metal_level?: string;
    plan_type?: string;
    hsa_eligible?: boolean;
    deductible_individual?: string;
    deductible_family?: string;
    moop_individual?: string;
    moop_family?: string;
    csr_level?: string | null;
    is_standardized?: boolean;
    primary_care_summary?: string | null;
    specialist_summary?: string | null;
    urgent_care_summary?: string | null;
    generic_rx_summary?: string | null;
  };
}

/** A nullable string field, normalised to "" so the UI never renders "null". */
function text(v: unknown): string {
  return typeof v === "string" && v.trim() !== "" ? v : "";
}

/**
 * Tidy an issuer name.
 *
 * Some come back with trailing punctuation — "Blue Cross Blue Shield of
 * Arizona," with the comma — which then appears on every card and in the
 * carrier filter. Only trailing separators are stripped; "Imperial Insurance
 * Companies, Inc." keeps its internal comma.
 */
function carrierName(v: unknown): string {
  return text(v).replace(/[,;\s]+$/, "");
}

/** Money arrives as a string like "395.66". Guard before coercing: Number("")
 *  is 0 and Number(undefined) is NaN, and both would render as a real price. */
function money(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Humanise a metal level.
 *
 * The API returns `expanded_bronze`, not `Bronze` — an underscored enum that
 * would have been shown to a client verbatim. "Expanded Bronze" is a real ACA
 * category (a bronze plan meeting the higher actuarial band), so it is spelled
 * out rather than collapsed into "Bronze".
 */
function metalLabel(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function normalizePlan(p: HsPlan): QuotedPlan {
  const pricing = p.pricing ?? {};
  const details = p.details ?? {};

  const gross = money(pricing.gross_premium) ?? 0;
  const subsidy = money(pricing.subsidy_applied) ?? 0;
  /* Prefer HealthSherpa's own net figure. It is the number the client will be
   * billed, and recomputing gross minus subsidy risks disagreeing with the
   * carrier over a rounding cent. Fall back only if it is absent. */
  const net = money(pricing.net_premium) ?? Math.max(0, gross - subsidy);

  return {
    planId: String(p.plan_id ?? ""),
    /* `display_name` carries the carrier ("Oscar Health Plan Bronze Simple");
     * `name` is just the plan ("Bronze Simple"). The card shows the carrier on
     * its own line, so the bare name avoids saying it twice. */
    planName: String(p.name ?? p.display_name ?? ""),
    carrier: carrierName(p.issuer?.name),
    metalLevel: metalLabel(details.metal_level),
    /* plan_id IS the HIOS plan id (e.g. 13877AZ0070072) and issuer_id its
     * first five digits — the two fields the Jot needs. */
    planHiosId: String(p.plan_id ?? ""),
    carrierHiosId: String(p.issuer?.issuer_id ?? ""),
    premium: gross,
    aptc: subsidy,
    netPremium: net,
    /* Individual figures: the card is read to one person at a kitchen table,
     * and the family numbers are double the width for the same column. */
    deductible: money(details.deductible_individual),
    moop: money(details.moop_individual),
    planType: (details.plan_type ?? p.network?.type ?? "").toUpperCase(),
    hsaEligible: details.hsa_eligible === true,

    /* Was all being discarded. Present on every live plan, at no extra
     * request — see the comment on SelectedPlan in lib/types.ts. */
    deductibleFamily: money(details.deductible_family),
    moopFamily: money(details.moop_family),
    primaryCare: text(details.primary_care_summary),
    specialist: text(details.specialist_summary),
    urgentCare: text(details.urgent_care_summary),
    genericRx: text(details.generic_rx_summary),
    isStandardized: details.is_standardized === true,
    networkName: text(p.network?.name),
    sbcUrl: text(p.documents?.sbc_url),
    formularyUrl: text(p.documents?.formulary_url),
    networkUrl: text(p.documents?.network_url ?? p.network?.network_url),
    brochureUrl: text(p.documents?.brochure_url),
    issuerPhone: text(p.issuer?.customer_service_phone),
    ratingArea: text(p.availability?.rating_area),
    releaseId: text(p.release?.release_id),
  };
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
  };

  try {
    /**
     * Every page, not the first one.
     *
     * This asked for `page: { number: 1, size: 40 }` and returned whatever
     * came back, which looked like "the market has 40 plans". It does not.
     * The same household in Maricopa AZ has 85, and because the sort is
     * premium ascending, the 45 being dropped were the expensive end: ALL 26
     * Gold plans and 18 of the 30 Silvers. An agent sitting with a client who
     * has a chronic condition could not see a single Gold plan, and nothing on
     * screen suggested one existed.
     *
     * `meta.result_count` does not help — it counts the rows on the page, not
     * the market — so exhaustion is the only way to know we have them all: keep
     * asking until a page comes back short.
     */
    const plans: QuotedPlan[] = [];
    const warnings: string[] = [];
    const PAGE_SIZE = 100;
    /* A bound, so a pathological county cannot turn one quote into twenty
     * upstream calls while an agent waits. */
    const MAX_PAGES = 4;
    let truncated = false;

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const data = (await hsFetch("/v1/quotes", {
        method: "POST",
        body: JSON.stringify({
          ...quoteRequest,
          page: { number: pageNumber, size: PAGE_SIZE },
        }),
      })) as { plans?: HsPlan[]; meta?: { warnings?: string[] } };

      const batch = data.plans ?? [];
      plans.push(...batch.map(normalizePlan));

      /* Non-fatal advisories about our own request. Discarding them meant
       * HealthSherpa could tell us something was wrong and nobody would ever
       * see it. */
      for (const w of data.meta?.warnings ?? []) {
        if (!warnings.includes(w)) warnings.push(w);
      }

      if (batch.length < PAGE_SIZE) break;
      if (pageNumber === MAX_PAGES) truncated = true;
    }

    if (warnings.length > 0) {
      console.warn(`[quotes] HealthSherpa advisories: ${warnings.join(" | ")}`);
    }
    if (truncated) {
      console.warn(
        `[quotes] hit the ${MAX_PAGES}-page cap for ${zip}/${fips} — ${plans.length} plans returned, there may be more`,
      );
    }

    return NextResponse.json({ plans, fixture: false, warnings, truncated });
  } catch (err) {
    if (err instanceof HealthSherpaUpstreamError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status === 429 ? 429 : 502 });
    }
    return NextResponse.json({ error: "Quote lookup failed. Please try again." }, { status: 500 });
  }
}

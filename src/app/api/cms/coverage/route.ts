import { NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import { cmsConfigured, fetchCoverage, CmsError } from "@/lib/cms";

export const dynamic = "force-dynamic";

/** A quote returns up to a few hundred plans; this bounds the fan-out. */
const MAX_PLANS = 200;
/** Enough for a client's medication list without inviting a fishing trip. */
const MAX_ITEMS = 12;

/**
 * POST /api/cms/coverage — which of these plans cover these drugs and doctors.
 *
 * Returns rows ONLY for what CMS answered. A plan absent from the response has
 * published nothing, which the client renders as "not published" and never as
 * "not covered" — see the rules in lib/cmsCoverage.ts. Reporting an exclusion
 * that CMS did not state would be a wrong answer about someone's medication.
 */
export async function POST(request: Request) {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!cmsConfigured()) {
    return NextResponse.json(
      { error: "Drug and provider lookup is not configured on this deployment." },
      { status: 501 },
    );
  }

  let body: { planIds?: unknown; rxcuis?: unknown; npis?: unknown; year?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const planIds = ids(body.planIds, /^[A-Za-z0-9]{1,20}$/).slice(0, MAX_PLANS);
  const rxcuis = ids(body.rxcuis, /^\d{1,12}$/).slice(0, MAX_ITEMS);
  const npis = ids(body.npis, /^\d{10}$/).slice(0, MAX_ITEMS);
  const year = Number(body.year);

  if (planIds.length === 0) {
    return NextResponse.json({ error: "planIds is required." }, { status: 400 });
  }
  if (rxcuis.length === 0 && npis.length === 0) {
    return NextResponse.json({ error: "Nothing to check." }, { status: 400 });
  }
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "A valid plan year is required." }, { status: 400 });
  }

  try {
    const { drugs, providers } = await fetchCoverage(planIds, rxcuis, npis, year);
    return NextResponse.json({ drugs, providers, plansAsked: planIds.length });
  } catch (err) {
    if (err instanceof CmsError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    throw err;
  }
}

/**
 * Keep only well-formed identifiers.
 *
 * These go into a query string against a third party, so the shape is checked
 * rather than escaped — an rxcui is digits, an NPI is exactly ten of them, and
 * a HIOS plan id is alphanumeric. Anything else is dropped rather than
 * forwarded.
 */
function ids(value: unknown, shape: RegExp): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && shape.test(v)))];
}

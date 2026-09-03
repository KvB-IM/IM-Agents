import { NextRequest, NextResponse } from "next/server";
import { currentAgentOrNull } from "@/lib/session";
import {
  cmsConfigured,
  searchDrugs,
  searchProviders,
  CmsError,
  type ProviderKind,
} from "@/lib/cms";
import { spellingSuggestions } from "@/lib/rxnorm";

export const dynamic = "force-dynamic";

/**
 * GET /api/cms/search?kind=drug|provider&q=…
 *
 * Behind the session like every other route: the CMS key is ours, and an open
 * proxy to it would let anyone spend our rate limit and outlive our credential.
 */
export async function GET(request: NextRequest) {
  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  if (!cmsConfigured()) {
    return NextResponse.json(
      { error: "Drug and provider lookup is not configured on this deployment." },
      { status: 501 },
    );
  }

  const params = request.nextUrl.searchParams;
  const kind = params.get("kind");
  const q = (params.get("q") ?? "").slice(0, 100);
  /* Coverage is published per plan YEAR, so it has to match the effective date
   * the quote was run for — not today's year. A January effective date sits in
   * the next plan year, and answering from the wrong year is a wrong answer. */
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return NextResponse.json({ error: "A valid plan year is required." }, { status: 400 });
  }

  try {
    if (kind === "drug") {
      const { drugs, yearUsed } = await searchDrugs(q, year);
      /* Only on an empty result, and only for drugs. CMS does not tolerate a
       * typo — or reliably a partial word — so an empty search is far more
       * often a spelling problem than a drug that is genuinely absent. The
       * suggestions are returned for the AGENT to pick: see lib/rxnorm.ts for
       * why nothing is substituted automatically. */
      const suggestions = drugs.length === 0 ? await spellingSuggestions(q) : [];
      /* `yearUsed` differs from `year` when CMS has not published the plan
         year yet — normal for a January effective date during open enrollment.
         Passed on so the UI can say which year it answered from. */
      return NextResponse.json({ drugs, suggestions, yearUsed });
    }
    if (kind === "provider") {
      const zip = params.get("zip") ?? "";
      const type = params.get("type") === "Facility" ? "Facility" : "Individual";
      const { providers, yearUsed } = await searchProviders(
        q,
        zip,
        type as ProviderKind,
        year,
      );
      return NextResponse.json({ providers, yearUsed });
    }
    return NextResponse.json({ error: "kind must be drug or provider." }, { status: 400 });
  } catch (err) {
    if (err instanceof CmsError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    throw err;
  }
}

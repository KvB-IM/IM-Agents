import { NextRequest, NextResponse } from "next/server";
import { hsFetch, hsConfigured, HealthSherpaUpstreamError } from "@/lib/healthsherpa";
import { fixtureCounties } from "@/lib/fixtures";
import type { County } from "@/lib/types";

/**
 * GET /api/hs/counties?zip_code=85201 → HealthSherpa /v1/reference/counties
 *
 * Must run before a quote: quoting requires a fips_code, and a ZIP can span
 * more than one county, so the agent has to choose. Ported from
 * IM-Website/src/app/api/hs/counties/route.ts.
 */
export async function GET(request: NextRequest) {
  const zip = request.nextUrl.searchParams.get("zip_code") ?? "";
  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json(
      { error: "A five-digit zip_code query parameter is required." },
      { status: 400 },
    );
  }

  if (!hsConfigured()) {
    return NextResponse.json({ counties: fixtureCounties(zip), fixture: true });
  }

  try {
    const data = (await hsFetch(
      `/v1/reference/counties?zip_code=${encodeURIComponent(zip)}`,
    )) as { counties?: Array<{ fips_code?: string; name?: string; state?: string }> };

    /* HealthSherpa returns "Maricopa County" — with the word. The UI renders
     * "{name} County, {state}", which turned that into "Maricopa County
     * County, AZ". Stripping the suffix here rather than in the component
     * keeps every consumer consistent, and matches what the fixtures return.
     *
     * Louisiana parishes and Alaska boroughs carry their own suffixes, so this
     * only removes a trailing "County" and leaves those alone. */
    const counties: County[] = (data.counties ?? []).map((c) => ({
      fipsCode: String(c.fips_code ?? ""),
      name: String(c.name ?? "").replace(/\s+County$/i, "").trim(),
      state: String(c.state ?? "").toUpperCase(),
    })).filter((c) => c.fipsCode && c.state);

    return NextResponse.json({ counties, fixture: false });
  } catch (err) {
    if (err instanceof HealthSherpaUpstreamError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status === 429 ? 429 : 502 });
    }
    return NextResponse.json({ error: "County lookup failed." }, { status: 500 });
  }
}

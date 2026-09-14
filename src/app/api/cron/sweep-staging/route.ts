import { NextRequest, NextResponse } from "next/server";
import { sweepStaged, stagingConfigured, STAGING_TTL_DAYS } from "@/lib/staging";
import { cronAuthFailure } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sweep-staging — delete abandoned staged uploads.
 *
 * The backstop. A blob that reached the CRM is deleted the moment Zoho confirms
 * it, so what this catches is an upload abandoned before submission: a closed
 * tab, a dead battery, an agent who changed their mind. Those would otherwise
 * sit in the bucket holding a photograph of somebody's driver's license
 * indefinitely.
 *
 * Authorised by CRON_SECRET via lib/cronAuth.ts, shared with the retention
 * route so the two checks cannot drift.
 */
export async function GET(request: NextRequest) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  if (!stagingConfigured()) {
    return NextResponse.json({ skipped: "no blob store configured" });
  }

  try {
    const result = await sweepStaged();
    console.info(
      `[staging] sweep: examined ${result.examined}, deleted ${result.deleted}, ` +
        `errors ${result.errors} (older than ${STAGING_TTL_DAYS} days)`,
    );
    return NextResponse.json({ ok: true, ttlDays: STAGING_TTL_DAYS, ...result });
  } catch (err) {
    console.error("[staging] sweep failed:", err);
    return NextResponse.json({ error: "The sweep failed." }, { status: 500 });
  }
}

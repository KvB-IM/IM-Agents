import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sweepStaged, stagingConfigured, STAGING_TTL_DAYS } from "@/lib/staging";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sweep-staging — delete abandoned staged uploads.
 *
 * The backstop. A blob that reached the CRM is deleted the moment Zoho confirms
 * it, so what this catches is an upload abandoned before submission: a closed
 * tab, a dead battery, an agent who changed their mind. Those would otherwise
 * sit in the bucket holding a photograph of somebody's driver's licence
 * indefinitely.
 *
 * Authorised by CRON_SECRET rather than a session, because Vercel Cron has no
 * session. Compared in constant time, and the endpoint refuses outright when
 * the secret is unset — an unauthenticated delete-things endpoint is worse than
 * no sweep.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so this endpoint is disabled." },
      { status: 503 },
    );
  }

  /* Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
  const offered = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (
    offered.length !== expected.length ||
    !timingSafeEqual(Buffer.from(offered), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

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

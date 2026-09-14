import { NextRequest, NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cronAuth";
import { runRetention } from "@/lib/retention";
import { RETENTION_DAYS } from "@/lib/retentionPolicy";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/retention — apply the fifteen-day retention rule.
 *
 * Until this existed, db/004's purge was a comment and settled submissions
 * accumulated forever. Deletes only what the CRM already holds (settled
 * submissions, submitted drafts) or what nobody is coming back for (expired
 * drafts). Never touches an unsettled submission — see lib/retention.ts.
 *
 * Scheduled in vercel.json. Authorised by CRON_SECRET via lib/cronAuth.ts.
 */
export async function GET(request: NextRequest) {
  const denied = cronAuthFailure(request);
  if (denied) return denied;

  if (!dbConfigured()) {
    return NextResponse.json({ skipped: "no database configured" });
  }

  try {
    const result = await runRetention();
    console.info(
      `[retention] purged ${result.settledSubmissions} settled submission(s), ` +
        `${result.expiredDrafts} expired draft(s), ${result.submittedDrafts} submitted draft(s) ` +
        `(older than ${RETENTION_DAYS} days)`,
    );
    return NextResponse.json({ ok: true, retentionDays: RETENTION_DAYS, ...result });
  } catch (err) {
    console.error("[retention] purge failed:", err);
    return NextResponse.json({ error: "The purge failed." }, { status: 500 });
  }
}

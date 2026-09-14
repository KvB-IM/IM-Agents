import "server-only";
import { sql, dbConfigured } from "./db";
import { RETENTION_DAYS } from "./retentionPolicy";

/**
 * Apply the retention rule. Run nightly by /api/cron/retention.
 *
 * Three deletes, each mirroring a predicate in lib/retentionPolicy.ts:
 *   1. submissions the CRM confirmed, settled more than RETENTION_DAYS ago;
 *   2. drafts never submitted, past their expiry;
 *   3. drafts submitted more than RETENTION_DAYS ago.
 *
 * What it will never do is delete an UNSETTLED submission — db/004's warning.
 * Those are applications that did not reach the CRM, and the only correct
 * disposal is a person reconciling them.
 *
 * `make_interval(days => $1)` rather than a spliced `interval '15 days'`, so the
 * number is bound as a parameter and comes from one place.
 */
export interface RetentionResult {
  settledSubmissions: number;
  expiredDrafts: number;
  submittedDrafts: number;
}

export async function runRetention(): Promise<RetentionResult> {
  if (!dbConfigured()) {
    return { settledSubmissions: 0, expiredDrafts: 0, submittedDrafts: 0 };
  }
  const db = sql();

  const settled = await db`
    delete from jot_submissions
     where zoho_status = 'success'
       and settled_at < now() - make_interval(days => ${RETENTION_DAYS})
    returning id
  `;
  const expired = await db`
    delete from drafts
     where submitted_at is null
       and expires_at < now()
    returning id
  `;
  const submitted = await db`
    delete from drafts
     where submitted_at is not null
       and submitted_at < now() - make_interval(days => ${RETENTION_DAYS})
    returning id
  `;

  return {
    settledSubmissions: settled.length,
    expiredDrafts: expired.length,
    submittedDrafts: submitted.length,
  };
}

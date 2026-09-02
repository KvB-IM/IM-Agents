import "server-only";
import { sql, dbConfigured } from "./db";
import { redactSsns, bufferDate } from "./redact";

/**
 * The submission replay buffer.
 *
 * A row is written BEFORE the CRM call and updated with the outcome after, so a
 * completed application survives a Zoho failure and can be replayed. Directly
 * modelled on `IM-Website`'s `lead_submissions`, for the same reason.
 *
 * This is not paranoia. Two Zoho rejections have already been found in
 * development that would each have destroyed a finished application in the
 * field: a `Name` field that is system-mandatory and was not being sent, and a
 * datetime format Zoho refuses. Neither produced any client-visible signal
 * beyond a failed submit.
 *
 * ── It is a buffer, not an archive ────────────────────────────────────────
 * Zoho CRM is the system of record. Rows that reached the CRM are safe to purge
 * after a short window; rows that did not are the entire point and must be
 * reconciled by a person first. See db/004.
 *
 * ── SSNs are redacted ────────────────────────────────────────────────────
 * The stored payload keeps only the last four digits. A second complete copy of
 * every applicant's and dependent's SSN is a larger standing liability than the
 * recovery it buys, and the SSN is precisely the field that can be re-collected
 * from the client in the rare case a replay is needed. `IM-Website` keeps last
 * four for the same reason.
 */

export type SettleStatus = "success" | "rejected" | "error" | "duplicate";

export interface AttemptSummary {
  agentId: string;
  formId: string;
  clientName: string;
  requestedEffective: string;
  carrier: string;
  clientIp: string | null;
  userAgent: string | null;
}

/**
 * Record an attempt before the CRM is called.
 *
 * Deliberately NON-FATAL. If this write fails the submission still proceeds:
 * the buffer exists to catch *Zoho* failures, which are the common case, and
 * letting a Neon outage block every field submission would be the worse
 * failure. The loss is logged loudly, because it means the next Zoho rejection
 * has no net under it.
 *
 * Returns whether the row was written, so the caller knows whether settling is
 * worth attempting.
 */
export async function recordAttempt(
  summary: AttemptSummary,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!dbConfigured()) return false;

  try {
    const db = sql();
    await db`
      insert into jot_submissions
        (agent_id, form_id, client_name, requested_effective, carrier,
         payload, zoho_status, client_ip, user_agent)
      values
        (${summary.agentId}, ${summary.formId}, ${summary.clientName},
         ${bufferDate(summary.requestedEffective)}, ${summary.carrier},
         ${JSON.stringify(redactSsns(payload))}::jsonb, 'pending',
         ${summary.clientIp}, ${summary.userAgent})
      on conflict (form_id) do update
         set payload      = excluded.payload,
             zoho_status  = 'pending',
             zoho_error   = null,
             settled_at   = null,
             client_ip    = excluded.client_ip,
             user_agent   = excluded.user_agent
    `;
    return true;
  } catch (err) {
    console.error(
      "[submissions] could not record the attempt — proceeding to the CRM " +
        "WITHOUT a replay buffer for this submission:",
      err,
    );
    return false;
  }
}

/**
 * Record the outcome.
 *
 * Also non-fatal: a settled row that fails to update looks unsettled, which
 * shows up in reconciliation as a false positive. That is the safe direction —
 * a human looks at a submission that actually succeeded, rather than a lost one
 * going unnoticed.
 */
export async function settleAttempt(
  formId: string,
  status: SettleStatus,
  detail?: { zohoId?: string; error?: string },
): Promise<void> {
  if (!dbConfigured()) return;

  try {
    const db = sql();
    await db`
      update jot_submissions
         set zoho_status = ${status},
             zoho_id     = ${detail?.zohoId ?? null},
             zoho_error  = ${detail?.error ? detail.error.slice(0, 1000) : null},
             settled_at  = now()
       where form_id = ${formId}
    `;
  } catch (err) {
    console.error(`[submissions] could not settle ${formId} as ${status}:`, err);
  }
}

/**
 * Submissions that never reached the CRM.
 *
 * The whole reason the table exists, and the query db/004 warns not to purge.
 * Surfaced to admins so a lost application is noticed by someone rather than
 * waiting for a client to call.
 */
export interface UnsettledSubmission {
  id: string;
  createdAt: string;
  formId: string;
  clientName: string | null;
  status: string;
  error: string | null;
}

export async function unsettledSubmissions(limit = 20): Promise<UnsettledSubmission[]> {
  if (!dbConfigured()) return [];

  try {
    const db = sql();
    const rows = (await db`
      select id, created_at, form_id, client_name, zoho_status, zoho_error
        from jot_submissions
       where zoho_status <> 'success'
       order by created_at desc
       limit ${Math.min(Math.max(1, limit), 100)}
    `) as Array<{
      id: number;
      created_at: string;
      form_id: string;
      client_name: string | null;
      zoho_status: string;
      zoho_error: string | null;
    }>;

    return rows.map((r) => ({
      id: String(r.id),
      createdAt: r.created_at,
      formId: r.form_id,
      clientName: r.client_name,
      status: r.zoho_status,
      error: r.zoho_error,
    }));
  } catch (err) {
    console.error("[submissions] could not read unsettled submissions:", err);
    return [];
  }
}

import "server-only";
import { randomBytes } from "node:crypto";
import { sql, dbConfigured } from "./db";
import { encryptSecret, decryptSecret, encryptionConfigured } from "./crypto";
import { splitSsns, heldKeys, type HeldSsns } from "./draftSsn";
import { RETENTION_DAYS } from "./retentionPolicy";
import type { CaptureDraft } from "./types";

/**
 * Server-side drafts — the backup of an in-progress application.
 *
 * The browser keeps working from sessionStorage; this mirrors it. Every save
 * re-encrypts the SSNs into `ssn_cipher`, stores everything else in `payload`,
 * and pushes `expires_at` out another RETENTION_DAYS. On a fresh device or an
 * emptied browser the agent's most recent open draft is offered back — WITHOUT
 * its SSNs, which are never returned to a browser and are instead merged in
 * server-side at submit (see api/enrollments and lib/draftSsn.ts).
 *
 * ── Scoping is structural ─────────────────────────────────────────────────
 * Every statement here carries `agent_id = $agent` in its WHERE. An agent
 * cannot read, overwrite or delete another agent's draft, and the guarantee is
 * in the query rather than in a check a route is trusted to remember — scope
 * section 7.1.
 *
 * ── Non-fatal ─────────────────────────────────────────────────────────────
 * Like the submissions buffer, this is a safety net. A Neon outage must not
 * stop an agent working: reads return null/empty, writes return null, and the
 * failure is logged. The browser copy is still there.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isDraftId(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function draftsConfigured(): boolean {
  return dbConfigured() && encryptionConfigured();
}

/* Short, sayable, unambiguous: no 0/O, 1/I/L. ~1e9 codes; a collision retries. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newResumeCode(): string {
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

export interface StoredDraft {
  draft: CaptureDraft;
  /** People whose SSN is held server-side. The SSNs themselves are not here. */
  heldSsnKeys: string[];
  resumeCode: string;
  updatedAt: string;
}

interface Row {
  id: string;
  payload: CaptureDraft;
  ssn_cipher: string | null;
  resume_code: string;
  updated_at: string;
}

function decryptHeld(cipher: string | null): HeldSsns {
  if (!cipher) return {};
  const plain = decryptSecret(cipher);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: HeldSsns = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && /^\d{9}$/.test(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Save (upsert) the agent's draft.
 *
 * Held SSNs are MERGED, not replaced: a browser that resumed a draft sends
 * blank SSN fields for people whose number is only on the server, and a naive
 * overwrite would erase them the first time the agent touched any other field.
 * Anything typed in this save wins over what was held.
 *
 * Returns which people now have a held SSN, or null when the row could not be
 * written — including when it belongs to another agent or is already submitted.
 */
export async function saveDraft(
  agentId: string,
  draft: CaptureDraft,
): Promise<{ heldSsnKeys: string[] } | null> {
  if (!draftsConfigured() || !isDraftId(draft.id)) return null;

  try {
    const db = sql();
    const { payload, ssns } = splitSsns(draft);

    const existing = (await db`
      select ssn_cipher from drafts
       where id = ${draft.id} and agent_id = ${agentId} and submitted_at is null
    `) as Array<{ ssn_cipher: string | null }>;
    const held: HeldSsns = { ...decryptHeld(existing[0]?.ssn_cipher ?? null), ...ssns };
    const cipher = Object.keys(held).length ? encryptSecret(JSON.stringify(held)) : null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rows = (await db`
          insert into drafts
            (id, agent_id, resume_code, payload, ssn_cipher, expires_at, updated_at)
          values
            (${draft.id}, ${agentId}, ${newResumeCode()}, ${JSON.stringify(payload)}::jsonb,
             ${cipher}, now() + make_interval(days => ${RETENTION_DAYS}), now())
          on conflict (id) do update
             set payload    = excluded.payload,
                 ssn_cipher = excluded.ssn_cipher,
                 expires_at = excluded.expires_at,
                 updated_at = now()
           where drafts.agent_id = ${agentId}
             and drafts.submitted_at is null
          returning id
        `) as Array<{ id: string }>;
        if (rows.length === 0) return null; // not this agent's, or already filed
        return { heldSsnKeys: heldKeys(held) };
      } catch (err) {
        /* 23505 on the resume-code index: astronomically rare, retried once
         * with a fresh code. Anything else propagates to the outer catch. */
        if ((err as { code?: string })?.code === "23505" && attempt === 0) continue;
        throw err;
      }
    }
    return null;
  } catch (err) {
    console.error("[drafts] save failed — the browser copy is still the working one:", err);
    return null;
  }
}

function toStored(row: Row): StoredDraft {
  return {
    draft: row.payload,
    heldSsnKeys: heldKeys(decryptHeld(row.ssn_cipher)),
    resumeCode: row.resume_code,
    updatedAt: row.updated_at,
  };
}

/** One open, unexpired draft — the agent's own. SSNs are not included. */
export async function loadDraft(agentId: string, id: string): Promise<StoredDraft | null> {
  if (!draftsConfigured() || !isDraftId(id)) return null;
  try {
    const db = sql();
    const rows = (await db`
      select id, payload, ssn_cipher, resume_code, updated_at
        from drafts
       where id = ${id} and agent_id = ${agentId}
         and submitted_at is null and expires_at > now()
    `) as Row[];
    return rows[0] ? toStored(rows[0]) : null;
  } catch (err) {
    console.error("[drafts] load failed:", err);
    return null;
  }
}

/** The agent's most recently saved open draft, for resume-on-load. */
export async function latestOpenDraft(agentId: string): Promise<StoredDraft | null> {
  if (!draftsConfigured()) return null;
  try {
    const db = sql();
    const rows = (await db`
      select id, payload, ssn_cipher, resume_code, updated_at
        from drafts
       where agent_id = ${agentId}
         and submitted_at is null and expires_at > now()
       order by updated_at desc
       limit 1
    `) as Row[];
    return rows[0] ? toStored(rows[0]) : null;
  } catch (err) {
    console.error("[drafts] latest lookup failed:", err);
    return null;
  }
}

/**
 * The held SSNs, decrypted. SERVER ONLY — used by the submit route to fill
 * blanks before validation. Nothing hands this to a browser.
 */
export async function heldSsns(agentId: string, id: string): Promise<HeldSsns> {
  if (!draftsConfigured() || !isDraftId(id)) return {};
  try {
    const db = sql();
    const rows = (await db`
      select ssn_cipher from drafts
       where id = ${id} and agent_id = ${agentId} and submitted_at is null
    `) as Array<{ ssn_cipher: string | null }>;
    return decryptHeld(rows[0]?.ssn_cipher ?? null);
  } catch (err) {
    console.error("[drafts] held-SSN lookup failed — validating what the browser sent:", err);
    return {};
  }
}

/** The draft reached the CRM. Kept RETENTION_DAYS for a retry, then purged. */
export async function markSubmitted(agentId: string, id: string, jotId: string): Promise<void> {
  if (!dbConfigured() || !isDraftId(id)) return;
  try {
    const db = sql();
    await db`
      update drafts
         set submitted_at = now(), jot_id = ${jotId}, updated_at = now()
       where id = ${id} and agent_id = ${agentId} and submitted_at is null
    `;
  } catch (err) {
    console.error(`[drafts] could not mark ${id} submitted:`, err);
  }
}

/** The agent discarded it. Only an OPEN draft can be discarded this way. */
export async function discardDraft(agentId: string, id: string): Promise<void> {
  if (!dbConfigured() || !isDraftId(id)) return;
  try {
    const db = sql();
    await db`
      delete from drafts
       where id = ${id} and agent_id = ${agentId} and submitted_at is null
    `;
  } catch (err) {
    console.error(`[drafts] could not discard ${id}:`, err);
  }
}

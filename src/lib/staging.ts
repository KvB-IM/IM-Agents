import "server-only";
import { head, del, list } from "@vercel/blob";

/**
 * Blob staging for document uploads.
 *
 * ── Why staging rather than posting the file at us ────────────────────────
 * A serverless function has a ~4.5MB request-body cap, so a direct POST makes
 * "compress under 4.5MB" a CORRECTNESS requirement executed on a phone. Canvas
 * compression fails in ways we cannot control — iOS Safari has memory ceilings
 * on large images and `toBlob` can return null under pressure — and a failure
 * means the agent re-photographs a licence while sitting with the client.
 *
 * Uploading direct to the blob store bypasses the function entirely, so there
 * is no cap and compression becomes a bandwidth optimisation instead. Zoho's
 * own attachment limit (20MB) then applies, reached by an outbound fetch that
 * has no such restriction. This mirrors IM_CRM_Frontend, which runs both paths
 * and documents the same reasoning.
 *
 * ── Why not hand Zoho a URL ──────────────────────────────────────────────
 * Zoho can fetch an attachment from a URL, which would be simpler. It would
 * also mean a driver's licence sitting at a publicly reachable address for as
 * long as Zoho takes to collect it. The store is PRIVATE and the server reads
 * it back with credentials instead; IM_CRM_Frontend made the same call, with
 * the note that a document "is never readable by anyone who happens to have the
 * link".
 *
 * ── Lifetime ─────────────────────────────────────────────────────────────
 * Deleted as soon as Zoho confirms it holds the file — not merely accepted it.
 * The 14-day sweep is a backstop for uploads that were abandoned before
 * submission (a closed tab, a dead battery), not the normal path.
 */

/** Everything this app stages lives under one prefix, so the sweep is precise. */
export const STAGING_PREFIX = "staged/licenses/";

/** Zoho's own attachment ceiling. The blob path is what makes this reachable. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_UPLOAD_LABEL = "20 MB";

/** Abandoned uploads are swept after this long. */
export const STAGING_TTL_DAYS = 14;

export function stagingConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

/**
 * Is this one of our own staged blobs?
 *
 * Without this the forward endpoint would fetch whatever URL it was handed,
 * from wherever the server can reach — an SSRF with our credentials attached.
 * IM_CRM_Frontend has the same guard and the same comment, because it is the
 * obvious hole in a "give me a URL and I will upload it" endpoint.
 */
export function isStagedUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  // Vercel Blob serves from *.public.blob.vercel-storage.com and the private
  // equivalent; both end in blob.vercel-storage.com.
  if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return false;
  // And it must be under our prefix, so one app cannot be made to read
  // another's staged files even within the same store.
  return parsed.pathname.slice(1).startsWith(STAGING_PREFIX);
}

export interface StagedFile {
  buffer: Buffer;
  contentType: string;
  size: number;
}

/**
 * Read a staged blob back.
 *
 * Through `head` + an authenticated fetch rather than a bare GET of the URL:
 * the store is private, so the URL alone is not fetchable. That is the point of
 * it.
 */
export async function readStaged(url: string): Promise<StagedFile> {
  const meta = await head(url);
  if (!meta) throw new Error("staged file not found");
  if (meta.size > MAX_UPLOAD_BYTES) {
    throw new Error(`staged file is ${meta.size} bytes, over the ${MAX_UPLOAD_LABEL} limit`);
  }

  const res = await fetch(meta.downloadUrl);
  if (!res.ok) throw new Error(`staged read failed (${res.status})`);

  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: meta.contentType || "application/octet-stream",
    size: meta.size,
  };
}

/**
 * Delete a staged blob.
 *
 * Never throws. This runs in a `finally`, and the promise it keeps — that the
 * document does not stay in the bucket — must hold whether or not the rest of
 * the job succeeded. A failure to delete is logged and picked up by the sweep.
 */
export async function discardStaged(url: string): Promise<void> {
  try {
    await del(url);
  } catch (err) {
    console.error("[staging] could not delete a staged file, leaving it for the sweep:", err);
  }
}

export interface SweepResult {
  examined: number;
  deleted: number;
  errors: number;
}

/**
 * Delete staged files older than the TTL.
 *
 * The backstop, not the normal path — a blob that reached Zoho is deleted
 * immediately on confirmation. What this catches is an upload abandoned before
 * submission: a closed tab, a dead battery, an agent who changed their mind.
 * Those would otherwise sit in the bucket holding a photograph of somebody's
 * driver's licence indefinitely.
 */
export async function sweepStaged(now = new Date()): Promise<SweepResult> {
  const cutoff = now.getTime() - STAGING_TTL_DAYS * 86_400_000;
  const result: SweepResult = { examined: 0, deleted: 0, errors: 0 };
  let cursor: string | undefined;

  do {
    const page = await list({ prefix: STAGING_PREFIX, cursor, limit: 500 });
    for (const blob of page.blobs) {
      result.examined++;
      if (new Date(blob.uploadedAt).getTime() >= cutoff) continue;
      try {
        await del(blob.url);
        result.deleted++;
      } catch {
        result.errors++;
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return result;
}

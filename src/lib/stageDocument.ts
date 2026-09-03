import { upload } from "@vercel/blob/client";
import { compressImage } from "./compressImage";
import { BLOB_ACCESS, STAGING_PREFIX } from "./blobAccess";

/**
 * Photograph → staging blob.
 *
 * Shared by the application's photo ID step and by corrections, because the
 * reliability argument is the same in both places: the upload goes DIRECT to
 * the blob store, not through a serverless function, so there is no ~4.5MB
 * request cap and compression is a bandwidth optimisation rather than a
 * correctness requirement running on someone's phone. See lib/staging.ts.
 *
 * What the caller does next differs — capture attaches after the Jot exists,
 * corrections attach immediately — so this deliberately stops at staging.
 */

export interface StagedDocument {
  url: string;
  filename: string;
  bytes: number;
}

export interface StageResult extends StagedDocument {
  originalBytes: number;
  /** False when the original was sent as-is: compression is best-effort. */
  compressed: boolean;
}

export async function stageDocument(file: File): Promise<StageResult> {
  const result = await compressImage(file);
  if (result.passthrough && result.reason) {
    // Not surfaced to the agent: the upload still works, and "compression fell
    // back" is not something they can act on.
    console.info(`[upload] sent at full size — ${result.reason}`);
  }

  /* `access` MUST match what the token route declares. A client saying
   * "public" against a token issued for "private" is rejected by the blob API,
   * and because that response carries no CORS headers the browser reports it
   * as an unexplained CORS failure. The two are declared in one place. */
  const blob = await upload(
    // Prefixed here, not rewritten server-side — see STAGING_PREFIX.
    `${STAGING_PREFIX}${Date.now()}-${safeName(file.name)}`,
    result.file,
    { access: BLOB_ACCESS, handleUploadUrl: "/api/uploads/token" },
  );

  return {
    url: blob.url,
    filename: result.file.name,
    bytes: result.bytes,
    originalBytes: result.originalBytes,
    compressed: !result.passthrough,
  };
}

/** The name lands in a blob path and later a multipart part name. */
function safeName(name: string): string {
  const cleaned = (name || "photo.jpg").replace(/[^A-Za-z0-9._-]/g, "_").slice(-60);
  return cleaned || "photo.jpg";
}

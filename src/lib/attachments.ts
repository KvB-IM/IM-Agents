import "server-only";
import { zohoCredentials } from "./zohoToken";
import { ZohoError, assertRecordId, accessTokenForAttachments } from "./zoho";
import { JOT_MODULE } from "./jot";

/**
 * Zoho attachments.
 *
 * Ported from IM_CRM_Frontend's working `zohoUpload`. Two details that are easy
 * to get wrong and produce unhelpful errors:
 *
 *   * Send FormData with the Authorization header ONLY. Setting Content-Type
 *     by hand loses the multipart boundary and Zoho rejects the body.
 *   * The Attachments sub-resource REQUIRES an explicit `fields` list on read,
 *     unlike the record endpoints where it is optional.
 */

const API_VERSION = "v8";
const UPLOAD_TIMEOUT_MS = 120_000;

async function apiHost(): Promise<string> {
  const creds = await zohoCredentials();
  return creds?.apiDomain || process.env.ZOHO_API_HOST || "https://www.zohoapis.com";
}

async function authHeader(): Promise<string> {
  const creds = await zohoCredentials();
  if (!creds) {
    throw new ZohoError(500, "The CRM is not connected.");
  }
  return `Zoho-oauthtoken ${await accessTokenForAttachments()}`;
}

export interface ZohoAttachment {
  id: string;
  fileName: string;
  size: number;
  createdTime: string;
}

/**
 * Attach a file to a JOTS record.
 *
 * Returns the attachment id Zoho assigns, which is what makes confirmation
 * possible — see `attachmentExists`.
 */
export async function uploadAttachment(
  recordId: string,
  file: { filename: string; buffer: Buffer; contentType: string },
): Promise<string> {
  const safeId = assertRecordId(recordId);
  if (!file.buffer.length) throw new ZohoError(400, "That file is empty.");

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
    file.filename,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(
      `${await apiHost()}/crm/${API_VERSION}/${JOT_MODULE}/${safeId}/Attachments`,
      {
        method: "POST",
        // No Content-Type: fetch sets it, with the boundary.
        headers: { Authorization: await authHeader() },
        body: form,
        signal: controller.signal,
        cache: "no-store",
      },
    );
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new ZohoError(504, "The upload to the CRM timed out.");
    }
    throw new ZohoError(502, "Could not reach the CRM to attach the file.", String(err));
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ code?: string; status?: string; details?: { id?: string } }>;
  };
  const row = body.data?.[0];

  if (!res.ok || row?.status !== "success" || !row?.details?.id) {
    throw new ZohoError(
      502,
      "The CRM would not accept the file.",
      `attach ${res.status}: ${row?.code ?? ""}`.trim(),
    );
  }

  return row.details.id;
}

/** Every attachment on a record. */
export async function listAttachments(recordId: string): Promise<ZohoAttachment[]> {
  const safeId = assertRecordId(recordId);

  const url = new URL(
    `${await apiHost()}/crm/${API_VERSION}/${JOT_MODULE}/${safeId}/Attachments`,
  );
  // Required on this sub-resource, unlike the record endpoints.
  url.searchParams.set("fields", "id,File_Name,Size,Created_Time");
  url.searchParams.set("per_page", "100");

  const res = await fetch(url, {
    headers: { Authorization: await authHeader() },
    cache: "no-store",
  });

  if (res.status === 204) return [];
  const body = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id?: string; File_Name?: string; Size?: string | number; Created_Time?: string }>;
  };
  if (!res.ok) {
    throw new ZohoError(502, "Could not read the record's attachments.", `list ${res.status}`);
  }

  return (body.data ?? []).map((a) => ({
    id: String(a.id ?? ""),
    fileName: String(a.File_Name ?? ""),
    size: Number(a.Size ?? 0),
    createdTime: String(a.Created_Time ?? ""),
  }));
}

/**
 * Confirm Zoho actually holds the attachment.
 *
 * This is the difference between "Zoho returned success" and "the file is
 * there", and it is what licenses deleting the staged copy. A create that
 * returns 2xx and then does not appear is exactly the failure that would
 * otherwise destroy the only copy of a document — and this codebase has
 * already met two Zoho writes that succeeded in shape and not in effect.
 *
 * Matched on the id Zoho returned, not the filename: two uploads of
 * "license.jpg" are indistinguishable by name.
 */
export async function attachmentExists(
  recordId: string,
  attachmentId: string,
): Promise<boolean> {
  try {
    const found = await listAttachments(recordId);
    return found.some((a) => a.id === attachmentId);
  } catch (err) {
    // An unverifiable attachment is treated as unconfirmed, so the staged copy
    // survives for the sweep rather than being deleted on a guess.
    console.error("[attachments] could not confirm the attachment:", err);
    return false;
  }
}

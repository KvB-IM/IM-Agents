import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { currentAgentOrNull } from "@/lib/session";
import { stagingConfigured, STAGING_PREFIX, MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/staging";

export const dynamic = "force-dynamic";

/**
 * POST /api/uploads/token — authorise a direct-to-blob upload.
 *
 * The browser uploads to the store itself, so the file never passes through
 * this function and the ~4.5MB serverless body cap does not apply. That is the
 * whole reason for staging; see lib/staging.ts.
 */
export async function POST(request: NextRequest) {
  if (!stagingConfigured()) {
    return NextResponse.json(
      {
        error: "Document uploads are not configured on this deployment.",
        code: "NO_STAGING",
      },
      { status: 501 },
    );
  }

  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await handleUpload({
      request,
      body: (await request.json()) as HandleUploadBody,
      onBeforeGenerateToken: async (pathname) => {
        /* Logged without the filename. Agents name files after the client, and
         * "Maria Gonzalez license.jpg" in a retained log line says who the
         * client is and that we hold their identity document — which is the
         * sort of thing the blob itself is deleted immediately to avoid. The
         * extension is what a refused upload is ever debugged from. */
        const ext = (pathname.match(/\.[A-Za-z0-9]{1,8}$/) || ["no ext"])[0];
        console.info(`[staging] token issued for a ${ext} upload`);

        return {
          /* No allowedContentTypes. IM_CRM_Frontend removed theirs because it
           * rejected legitimate files: a file the browser cannot type
           * confidently arrives as application/octet-stream, and the same image
           * is image/jpeg on one device and image/jpg on another. An allowlist
           * here turns a correct upload into a 400 nobody can read. */
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // Two photographs of the same licence must not collide.
          addRandomSuffix: true,
          /* Private. A driver's licence must not be readable by anyone who
           * happens to have the link — the server reads it back with
           * credentials instead. */
          access: "private" as never,
          pathname: pathname.startsWith(STAGING_PREFIX)
            ? pathname
            : `${STAGING_PREFIX}${pathname.replace(/^\/+/, "")}`,
        };
      },
      // Fires when the blob lands. Nothing to do — the browser tells us next,
      // and acting here would race it.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(body);
  } catch (err) {
    // The blob API's error carries no CORS headers, so the browser reports a
    // CORS failure and swallows the reason. This log is the only place it
    // exists.
    console.error("[staging] token refused:", err);
    return NextResponse.json(
      { error: `Could not start that upload. Files must be ${MAX_UPLOAD_LABEL} or smaller.` },
      { status: 400 },
    );
  }
}

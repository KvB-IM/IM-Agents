"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Camera, Check, AlertCircle, Trash2, Loader2 } from "lucide-react";
import { compressImage } from "@/lib/compressImage";
import { BLOB_ACCESS, STAGING_PREFIX } from "@/lib/blobAccess";
import { Card, CardHeader, Button } from "./ui";

export interface StagedDocument {
  url: string;
  filename: string;
  bytes: number;
}

/**
 * Photograph the applicant's license.
 *
 * Uploaded to staging as soon as it is taken — WHILE THE AGENT IS STILL WITH
 * THE CLIENT — rather than held until submit. That separation is the reliability
 * decision: "did the photo leave the phone" and "did the CRM accept it" are
 * different problems, and only the first one needs the client present. A
 * connectivity failure surfaces here, where the license is still on the table.
 *
 * `capture="environment"` opens the rear camera directly on a phone, and the
 * same input still offers the photo library on a tablet or desktop.
 */
export default function LicenseCapture({
  document: staged,
  onChange,
}: {
  document: StagedDocument | null;
  onChange: (doc: StagedDocument | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"compressing" | "uploading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shrunk, setShrunk] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setShrunk(null);

    try {
      setBusy("compressing");
      const result = await compressImage(file);
      if (result.passthrough && result.reason) {
        // Not shown to the agent: the upload still works, and "compression
        // fell back" is not information they can act on.
        console.info(`[license] sent at full size — ${result.reason}`);
      } else {
        setShrunk(
          `${fmtBytes(result.originalBytes)} → ${fmtBytes(result.bytes)}`,
        );
      }

      setBusy("uploading");
      /* Direct to the store, not through our API. That is what removes the
         serverless body cap and makes the compression above an optimisation
         rather than a requirement. */
      /* `access` MUST match what the token route declares. A client saying
       * "public" against a token issued for "private" is rejected by the blob
       * API — and because an error response carries no CORS headers, the
       * browser reports it as a CORS failure and swallows the reason. That
       * cost a debugging round; the two are now declared in one place. */
      const blob = await upload(
        // Prefixed here, not rewritten server-side — see STAGING_PREFIX.
        `${STAGING_PREFIX}license-${Date.now()}.jpg`,
        result.file,
        {
          access: BLOB_ACCESS,
          handleUploadUrl: "/api/uploads/token",
        },
      );

      onChange({ url: blob.url, filename: result.file.name, bytes: result.bytes });
    } catch (err) {
      console.error("[license] upload failed:", err);
      setError(
        "That photo did not upload. Check the signal and try again — it has not been saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Photo ID"
        hint="A picture of the applicant's license, as proof of contact."
      />

      <div className="space-y-3 px-4 pb-4">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset so re-taking the same filename fires a change event again.
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />

        {staged ? (
          <div className="flex items-start justify-between gap-3 rounded-xl bg-success/5 px-3.5 py-3 ring-1 ring-success/25">
            <div className="flex min-w-0 items-start gap-2.5">
              <Check size={17} className="mt-0.5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-navy-900">Photo saved</p>
                <p className="mt-0.5 text-[12px] text-muted">
                  {fmtBytes(staged.bytes)}
                  {shrunk ? ` · compressed from ${shrunk.split(" → ")[0]}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setShrunk(null);
              }}
              aria-label="Remove the photo"
              className="tap -mr-1 flex w-10 shrink-0 items-center justify-center rounded-lg text-muted active:bg-navy-50 active:text-error"
            >
              <Trash2 size={17} aria-hidden />
            </button>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy !== null}
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden />
                {busy === "compressing" ? "Preparing…" : "Uploading…"}
              </>
            ) : (
              <>
                <Camera size={16} aria-hidden /> Take a photo
              </>
            )}
          </Button>
        )}

        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15"
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

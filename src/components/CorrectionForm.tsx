"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, AlertCircle, Wrench, X, Loader2 } from "lucide-react";
import { stageDocument } from "@/lib/stageDocument";
import { Card, CardHeader, Field, TextInput, Button } from "./ui";

interface CorrectionField {
  key: string;
  label: string;
  type: "text" | "date" | "ssn" | "phone" | "email" | "integer" | "number";
}

/**
 * Agent-side corrections.
 *
 * Only fields the office has left open are sent, and only ones the agent
 * actually filled — a blank is "no change", never "clear this value". The
 * server checks every key against its own allowlist regardless, so this form is
 * a convenience and not the boundary.
 *
 * Deliberately absent: the enrollment stage, the FFM ids, the problem list.
 * Those are the office's record of what happened, and an agent overwriting the
 * stage would corrupt every KPI that counts it.
 */
export default function CorrectionForm({
  jotId,
  groups,
  documents,
  label,
}: {
  jotId: string;
  groups: Array<{ title: string; fields: CorrectionField[] }>;
  documents: string[];
  /** What the collapsed button says — the office asking is a different
   *  errand from an agent spotting their own typo. */
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingDoc = useRef<string | null>(null);

  /**
   * Photograph a requested document and attach it to this form.
   *
   * Straight to the CRM, unlike the application's photo ID: the record already
   * exists, so there is nothing to wait for. Same direct-to-blob staging then
   * server-side forward, and the server only deletes the staged copy once Zoho
   * CONFIRMS it holds the file.
   */
  async function attachDocument(docLabel: string, file: File) {
    setUploadError(null);
    setUploading(docLabel);
    try {
      const staged = await stageDocument(file);
      const res = await fetch(`/api/enrollments/${jotId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: staged.url, filename: staged.filename }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))) as { error?: string };
        setUploadError(detail.error ?? "That photo did not reach the CRM.");
        return;
      }
      setUploaded((u) => ({ ...u, [docLabel]: staged.filename }));
    } catch {
      setUploadError("That photo did not upload. Check the signal and try again.");
    } finally {
      setUploading(null);
    }
  }

  const filled = Object.entries(values).filter(([, v]) => v.trim() !== "");

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/enrollments/${jotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: Object.fromEntries(filled) }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "The corrections could not be saved.");
        return;
      }
      setSaved(true);
      // Re-render the server component so the problem list reflects the change.
      router.refresh();
    } catch {
      setError("No connection. Try again when you have signal.");
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <Card>
        <div className="flex items-start gap-2.5 px-4 py-4">
          <Check size={18} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <div>
            <p className="text-[14px] font-semibold text-navy-900">Corrections sent</p>
            <p className="mt-0.5 text-[12px] leading-snug text-muted">
              The office will pick this up. The stage will change when they work it.
            </p>
            <button
              type="button"
              onClick={() => {
                setSaved(false);
                setOpen(false);
                setValues({});
              }}
              className="tap mt-2 -ml-1 text-[13px] font-semibold text-navy-700 active:text-navy-900"
            >
              Correct something else
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (!open) {
    return (
      <div className="px-4">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Wrench size={16} aria-hidden /> {label}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight text-navy-900">Corrections</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-muted">
            Fill in only what changed. Anything left blank stays as submitted.
          </p>
        </div>
        {/* Openable means closeable. Nothing has been sent yet, so this
            discards the typing rather than the record. */}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setValues({});
            setError(null);
          }}
          aria-label="Close corrections"
          className="tap -mr-1 -mt-1 flex w-9 shrink-0 items-center justify-center rounded-lg text-muted active:bg-navy-50"
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      {documents.length > 0 ? (
        <div className="space-y-2 border-t border-line px-4 py-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
            Documents requested
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so re-taking the same filename fires change again.
              e.target.value = "";
              const doc = pendingDoc.current;
              if (file && doc) void attachDocument(doc, file);
            }}
          />
          {documents.map((d) => (
            <div
              key={d}
              className="flex items-center justify-between gap-3 rounded-xl bg-navy-50 px-3 py-2.5 ring-1 ring-navy-100"
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-navy-900">{d}</span>
              {uploaded[d] ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold text-success">
                  <Check size={14} aria-hidden /> Sent
                </span>
              ) : (
                <button
                  type="button"
                  disabled={uploading !== null}
                  onClick={() => {
                    pendingDoc.current = d;
                    fileInput.current?.click();
                  }}
                  className="tap inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-navy-800 ring-1 ring-line active:bg-navy-50 disabled:text-muted"
                >
                  {uploading === d ? (
                    <>
                      <Loader2 size={14} className="animate-spin" aria-hidden /> Sending…
                    </>
                  ) : (
                    <>
                      <Camera size={14} aria-hidden /> Photo
                    </>
                  )}
                </button>
              )}
            </div>
          ))}
          {uploadError ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              {uploadError}
            </p>
          ) : (
            <p className="text-[11px] leading-snug text-muted">
              A photo attaches to the form as soon as it is taken — it does not wait for the
              corrections below.
            </p>
          )}
        </div>
      ) : null}

      {groups.map((group) => (
        <div key={group.title} className="border-t border-line px-4 py-4">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-muted">
            {group.title}
          </p>
          <div className="grid grid-cols-2 gap-3">
            {group.fields.map((f) => (
              <div key={f.key} className={f.type === "email" ? "col-span-2" : ""}>
                <Field label={f.label}>
                  <TextInput
                    type={f.type === "date" ? "date" : f.type === "email" ? "email" : "text"}
                    inputMode={
                      f.type === "ssn" || f.type === "integer" || f.type === "number"
                        ? "numeric"
                        : f.type === "phone"
                          ? "tel"
                          : undefined
                    }
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    autoComplete="off"
                    autoCapitalize={f.type === "email" ? "off" : undefined}
                  />
                </Field>
              </div>
            ))}
          </div>
        </div>
      ))}

      {error ? (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="border-t border-line px-4 py-3">
        <Button onClick={submit} disabled={saving || filled.length === 0}>
          {saving
            ? "Sending…"
            : filled.length === 0
              ? "Nothing changed yet"
              : `Send ${filled.length} ${filled.length === 1 ? "correction" : "corrections"}`}
        </Button>
      </div>
    </Card>
  );
}

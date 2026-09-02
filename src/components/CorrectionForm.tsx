"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, AlertCircle, Wrench } from "lucide-react";
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
}: {
  jotId: string;
  groups: Array<{ title: string; fields: CorrectionField[] }>;
  documents: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
          </div>
        </div>
      </Card>
    );
  }

  if (!open) {
    return (
      <div className="px-4">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Wrench size={16} aria-hidden /> Submit corrections
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Corrections"
        hint="Fill in only what changed. Anything left blank stays as submitted."
      />

      {documents.length > 0 ? (
        <div className="space-y-2 border-t border-line px-4 py-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">
            Documents requested
          </p>
          {documents.map((d) => (
            <div
              key={d}
              className="flex items-center justify-between gap-3 rounded-xl bg-navy-50 px-3 py-2.5 ring-1 ring-navy-100"
            >
              <span className="min-w-0 truncate text-[13px] font-medium text-navy-900">{d}</span>
              <button
                type="button"
                className="tap inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-navy-800 ring-1 ring-line active:bg-navy-50"
              >
                <Camera size={14} aria-hidden /> Photo
              </button>
            </div>
          ))}
          <p className="text-[11px] leading-snug text-muted">
            Upload is not wired in this prototype. It reuses the existing
            direct-to-blob flow from the CRM app — see the README.
          </p>
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

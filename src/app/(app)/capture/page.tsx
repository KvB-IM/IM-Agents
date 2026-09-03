"use client";

import { useState, useMemo, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  Send,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  X,
  Pencil,
  Trash2,
} from "lucide-react";
import { useDraft } from "@/components/DraftContext";
import PersonEditor from "@/components/PersonEditor";
import { Card, CardHeader, Field, TextInput, Select, Toggle, Button, Empty, Inset } from "@/components/ui";
import { money, monthYear, shortDate } from "@/lib/format";
import { ssnConfirmed, ssnDigits } from "@/lib/ssn";
import { effectiveHouseholdSize } from "@/lib/household";
import LicenseCapture from "@/components/LicenseCapture";
import ReviewSummary from "@/components/ReviewSummary";
import { buildSections } from "@/lib/reviewRows.ts";
import { readCaptureUi, serializeCaptureUi, closedAt } from "@/lib/captureUi.ts";
import type { CaptureUi } from "@/lib/captureUi.ts";
import * as PL from "@/lib/picklists";
import { ENROLLMENT_EVENT_GROUPS, outsideSixtyDayWindow } from "@/lib/enrollmentEvents";
import type { Jot } from "@/lib/types";

/**
 * The application, in HealthSherpa's own screen order.
 *
 * The order is not ours: JOT_FIELDS in IM_CRM_Frontend/server/lines/aca.js is
 * deliberately grouped by HealthSherpa step, because a back-office enroller
 * reads the resulting Jot card while typing into HealthSherpa. Keeping the same
 * order here means the agent captures in the sequence the office will re-read.
 *
 * A stepper rather than one long page, unlike the quote: this is worked once,
 * front to back, and 40 fields on one scroll is where things get skipped.
 */

const STEPS = ["Applicant", "Address", "Household", "Income", "Coverage", "Review"] as const;

/** Where the agent is in the form. Beside the draft, and cleared with it. */
const UI_KEY = "im-agent-capture-ui-v1";

export default function CapturePage() {
  /* useSearchParams needs a Suspense boundary above it. */
  return (
    <Suspense fallback={null}>
      <Capture />
    </Suspense>
  );
}

function Capture() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { draft, patch, patchPerson, loaded, reset } = useDraft();
  /**
   * Whether the form is open, and which step — persisted, not component state.
   *
   * Reopening a saved application used to drop straight into the editable
   * stepper, which is wrong twice over: an agent tapping Application to check
   * what is on a form should not be one stray keystroke away from altering it,
   * and there was no way back out — no Close, so the only exit was another tab,
   * and returning reopened the same fields again. So arriving cold shows what
   * the application holds and asks.
   *
   * But holding that in component state broke something worse: this form is one
   * route, so every tab change unmounts it. An agent who tapped Quote to
   * re-check a premium came back to the gate, at step 1, place gone — the form
   * had closed itself behind them mid-enrollment. The position lives in
   * sessionStorage next to the draft for exactly the same reason the draft
   * does. See lib/captureUi.ts.
   */
  const [ui, setUi] = useState<CaptureUi | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /* Read once. `?start=1` means the agent just chose "Continue to application"
   * on the quote, which IS the decision to start filling it in — so it opens
   * the form directly. Captured in a ref because the URL is scrubbed
   * immediately afterwards and this must not re-fire and force the form back
   * open after a Close. */
  const startRequested = useRef(searchParams.get("start") === "1");

  useEffect(() => {
    if (!loaded) return;
    const saved = readCaptureUi(
      sessionStorage.getItem(UI_KEY),
      draft.id,
      STEPS.length,
    );
    setUi(startRequested.current ? { ...saved, editing: true } : saved);
    if (startRequested.current) {
      startRequested.current = false;
      /* Drop the parameter now rather than on Close. Left in the URL, a
         refresh would reopen the form and undo whatever the agent last did. */
      router.replace("/capture");
    }
  }, [loaded, draft.id, router]);

  useEffect(() => {
    if (!ui) return;
    try {
      sessionStorage.setItem(UI_KEY, serializeCaptureUi(ui));
    } catch {
      /* private mode or full quota: the position is still right in memory */
    }
  }, [ui]);

  const step = ui?.step ?? 0;
  const editing = ui?.editing ?? false;
  const setStep = (next: number | ((s: number) => number)) =>
    setUi((u) => {
      const base = u ?? closedAt(draft.id);
      const raw = typeof next === "function" ? next(base.step) : next;
      return { ...base, step: Math.min(Math.max(raw, 0), STEPS.length - 1) };
    });
  const setEditing = (open: boolean) =>
    setUi((u) => ({ ...(u ?? closedAt(draft.id)), editing: open }));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Jot | null>(null);
  /* Separate from `error`: the form succeeded and the photo did not, which is a
   * different message and must not read as a failed submission. */
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);

  /* Generated once per draft, so a double-tap or a retry on a dropped
     connection resolves to the same Jot instead of filing two. */
  const submissionKey = useMemo(() => `${draft.id}-submit`, [draft.id]);

  const primary = draft.people.find((p) => p.relation === "primary") ?? draft.people[0];

  /**
   * Why step 1 cannot be left yet, or null.
   *
   * SSN is required for everyone seeking coverage and must match its
   * confirmation. Blocking here rather than at submit is the point: an agent
   * who discovers a mismatch on the review screen has to navigate back through
   * five steps to a masked field with no idea which digit was wrong.
   */
  const applicantBlocker = (() => {
    const covered = draft.people.filter((p) => p.seekingCoverage);
    for (const person of covered) {
      const who =
        [person.firstName, person.lastName].filter(Boolean).join(" ") ||
        (person.relation === "primary" ? "the applicant" : "a household member");
      // Attested as never issued: no number to require or confirm.
      if (person.noSsn) continue;
      if (ssnDigits(person.ssn).length === 0) return `${who} needs an SSN.`;
      if (!ssnConfirmed(person.ssn, person.ssnConfirm)) {
        return `${who}'s SSN entries do not match.`;
      }
    }
    return null;
  })();

  const blocker = step === 0 ? applicantBlocker : null;
  const onReview = step === STEPS.length - 1;

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/enrollments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, submissionKey }),
      });
      const data = (await res.json()) as { jot?: Jot; error?: string };
      if (!res.ok || !data.jot) {
        setError(data.error ?? "The application could not be submitted.");
        return;
      }
      setSubmitted(data.jot);
      /* The position belonged to a form that no longer needs filling in. */
      try {
        sessionStorage.removeItem(UI_KEY);
      } catch {
        /* nothing to clear */
      }

      /* Attach the photo AFTER the Jot exists — an attachment needs a record
       * id. Deliberately not fatal to the submission: the application is
       * already filed, and telling an agent their whole form failed because a
       * photo did not attach would send them back through six steps for
       * nothing. The office can see a Jot with no ID and ask. */
      if (data.jot && draft.photoId) {
        try {
          const att = await fetch(`/api/enrollments/${data.jot.id}/attachments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url: draft.photoId.url,
              filename: draft.photoId.filename,
            }),
          });
          if (!att.ok) {
            const detail = (await att.json()) as { error?: string };
            setPhotoWarning(detail.error ?? "The photo did not attach to the CRM.");
          }
        } catch {
          setPhotoWarning(
            "The form was filed, but the photo did not attach. It is still saved — tell the office.",
          );
        }
      }
    } catch {
      setError("No connection. The application is saved — try again when you have signal.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded || !ui) return null;

  // ── Submitted ────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div className="space-y-4">
        <div className="border-y border-line bg-white p-6 text-center sm:rounded-2xl sm:border">
          <CheckCircle2 size={44} className="mx-auto text-success" aria-hidden />
          <h1 className="mt-3 text-[20px] font-bold tracking-tight text-navy-900">
            Filed as {submitted.formId}
          </h1>
          <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted">
            {submitted.clientName} is with the office now. You will see requirements and problems
            here as they work it.
          </p>
        </div>

        {photoWarning ? (
          <p className="mx-4 flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[13px] leading-snug text-navy-900 ring-1 ring-warning/25">
            <AlertCircle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            {photoWarning}
          </p>
        ) : null}
        <Inset className="space-y-2">
          <Button onClick={() => router.push(`/pipeline/${submitted.id}`)}>
            View in pipeline
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              router.push("/quote");
            }}
          >
            Start another quote
          </Button>
        </Inset>
      </div>
    );
  }

  // ── No plan selected ─────────────────────────────────────────────────────
  if (!draft.selectedPlan) {
    return (
      <div className="space-y-4">
        <Empty
          title="Quote first"
          body="The application needs a plan on it. Run a quote and pick one, then come back."
        />
        <Inset>
          <Link href="/quote" className="block">
            <Button variant="secondary">Go to quote</Button>
          </Link>
        </Inset>
      </div>
    );
  }

  // ── Saved application, opened cold ───────────────────────────────────────
  if (!editing) {
    const sections = buildSections(draft);
    const unanswered = sections.flatMap((sec) => sec.rows).filter((r) => r.missing).length;
    const name = [primary?.firstName, primary?.lastName].filter(Boolean).join(" ");

    return (
      <div className="space-y-4">
        <Inset>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-[22px] font-bold leading-tight tracking-tight text-navy-900">
              {name || "Application in progress"}
            </h1>
            {/* Leaves the draft alone. It is saved either way — this is a
                door out of the screen, not a discard. */}
            <button
              type="button"
              onClick={() => router.push("/pipeline")}
              aria-label="Close"
              className="tap -mr-1 -mt-1 flex w-10 shrink-0 items-center justify-center rounded-lg text-muted active:bg-navy-50"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            Not submitted. Saved on this device{" "}
            {draft.updatedAt ? `· last edited ${shortDate(draft.updatedAt)}` : ""}
          </p>
        </Inset>

        <Card>
          <CardHeader title="What is on it so far" />
          <dl className="divide-y divide-line px-4 pb-2">
            {[
              ["Plan", draft.selectedPlan.planName],
              ["Carrier", draft.selectedPlan.carrier],
              ["Net to client", `${money(draft.selectedPlan.netPremium)}/mo`],
              ["Effective", monthYear(draft.requestedEffective)],
              ["People on the form", String(draft.people.length)],
              ["County", draft.county ? `${draft.county.name}, ${draft.county.state}` : "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="text-[13px] text-muted">{k}</dt>
                <dd className="text-right text-[13px] font-medium text-navy-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-4 py-3 text-[12px] leading-snug text-muted">
            {unanswered === 0
              ? "Every question is answered. Open it to review and submit."
              : `${unanswered} ${unanswered === 1 ? "question is" : "questions are"} still unanswered.`}
          </p>
        </Card>

        <Inset className="space-y-2">
          <Button onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden />
            {step > 0
              ? `Open at ${STEPS[step]} · step ${step + 1} of ${STEPS.length}`
              : "Open and continue"}
          </Button>

          {/* Two taps, on purpose. This is the only copy of an application an
              agent may have spent twenty minutes on with a client. */}
          {confirmDiscard ? (
            <div className="rounded-xl bg-error/5 px-3.5 py-3 ring-1 ring-error/20">
              <p className="text-[13px] font-medium text-navy-900">
                Discard this application?
              </p>
              <p className="mt-0.5 text-[12px] leading-snug text-muted">
                Everything captured for {name || "this client"} is deleted from this device. It
                cannot be recovered.
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmDiscard(false)}
                  className="!w-auto flex-1"
                >
                  Keep it
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    try {
                      sessionStorage.removeItem(UI_KEY);
                    } catch {
                      /* nothing to clear */
                    }
                    reset();
                    setConfirmDiscard(false);
                    setUi(null);
                  }}
                  className="!w-auto flex-1"
                >
                  Discard
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmDiscard(true)}>
              <Trash2 size={16} aria-hidden /> Discard and start over
            </Button>
          )}
        </Inset>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stepper ────────────────────────────────────────────────────── */}
      <Inset>
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-bold tracking-tight text-navy-900">Application</h1>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-[12px] font-medium text-muted">
              {step + 1} of {STEPS.length}
            </span>
            {/* Closes the form without discarding it. Its absence was the
                reason an opened application felt like a trap: the only way
                out was the tab bar, which reopened it on the way back. */}
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="Close the application"
              className="tap -mr-1 flex w-9 items-center justify-center rounded-lg text-muted active:bg-navy-50"
            >
              <X size={20} aria-hidden />
            </button>
          </div>
        </div>
        <div className="mt-2 flex gap-1" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-navy-900" : "bg-line"}`}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[13px] font-medium text-navy-700">{STEPS[step]}</p>
      </Inset>

      {/* ── Selected plan, always visible ──────────────────────────────── */}
      <div className="mx-4 flex items-center justify-between gap-3 rounded-xl bg-navy-50 px-3.5 py-2.5 ring-1 ring-navy-100">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-navy-900">
            {draft.selectedPlan.planName}
          </p>
          <p className="text-[12px] text-muted">
            {draft.selectedPlan.carrier} · {monthYear(draft.requestedEffective)}
          </p>
        </div>
        <p className="shrink-0 text-[15px] font-bold text-navy-900">
          {money(draft.selectedPlan.netPremium)}
          <span className="text-[11px] font-medium text-muted">/mo</span>
        </p>
      </div>

      {/* ── Step 0: Applicant ──────────────────────────────────────────── */}
      {step === 0 ? (
        <Card>
          <CardHeader
            title="Applicant and household members"
            hint="Each SSN is entered twice. Digits hide as you type."
          />
          <div>
            {draft.people.map((person) => (
              <PersonEditor
                key={person.key}
                person={person}
                effectiveDate={draft.requestedEffective}
                onChange={(p) => patchPerson(person.key, p)}
                showSsn
              />
            ))}
          </div>
        </Card>
      ) : null}

      {/* ── Step 1: Address and contact ────────────────────────────────── */}
      {step === 1 ? (
        <Card>
          <CardHeader title="Home address and contact" hint="Where they actually live, as the exchange has it." />
          <div className="space-y-3 px-4 pb-4">
            <SubHead>Home address</SubHead>
            <Field label="Street">
              <TextInput
                value={draft.street}
                onChange={(e) => patch({ street: e.target.value })}
                autoComplete="off"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City">
                <TextInput value={draft.city} onChange={(e) => patch({ city: e.target.value })} />
              </Field>
              <Field label="ZIP / county">
                <TextInput
                  value={draft.county ? `${draft.zip} · ${draft.county.name}` : draft.zip}
                  disabled
                />
              </Field>
            </div>

            {/* Directly under the HOME address, deliberately. Sitting below the
                mailing block it read as "everyone lives at the MAILING
                address" — a different question, and the wrong one to answer.
                Only worth asking when more than one person is on the form. */}
            {draft.people.length > 1 ? (
              <PickField
                label="Everyone applying lives at this address"
                choices={PL.YES_NO}
                value={draft.everyoneSameAddress}
                onChange={(everyoneSameAddress) => patch({ everyoneSameAddress })}
                hint="If not, the office will need the other address."
              />
            ) : null}

            <SubHead>Contact</SubHead>
            <Field label="Email">
              <TextInput
                type="email"
                value={draft.email}
                onChange={(e) => patch({ email: e.target.value })}
                inputMode="email"
                autoCapitalize="off"
                autoComplete="off"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Mobile">
                <TextInput
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => patch({ phone: e.target.value })}
                  inputMode="tel"
                />
              </Field>
              <Field label="Home phone">
                <TextInput
                  type="tel"
                  value={draft.homePhone}
                  onChange={(e) => patch({ homePhone: e.target.value })}
                  inputMode="tel"
                />
              </Field>
            </div>

            <SubHead>Mailing address</SubHead>
            <Field label="Mailing address is the same as the home address">
              <Toggle
                value={draft.mailingSameAsHome}
                onChange={(v) => patch({ mailingSameAsHome: v })}
              />
            </Field>

            {/* Only shown when it differs. Asking for a second address that is
                almost always identical is four fields of busywork on a phone,
                and copying it by hand is what the office does today. */}
            {!draft.mailingSameAsHome ? (
              <div className="space-y-3 rounded-xl bg-navy-50 p-3 ring-1 ring-navy-100">
                <Field label="Mailing street">
                  <TextInput
                    value={draft.mailingStreet}
                    onChange={(e) => patch({ mailingStreet: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City">
                    <TextInput
                      value={draft.mailingCity}
                      onChange={(e) => patch({ mailingCity: e.target.value })}
                    />
                  </Field>
                  <Field label="State">
                    <TextInput
                      value={draft.mailingState}
                      onChange={(e) => patch({ mailingState: e.target.value.toUpperCase() })}
                      maxLength={2}
                      autoCapitalize="characters"
                    />
                  </Field>
                </div>
                <Field label="ZIP">
                  <TextInput
                    value={draft.mailingZip}
                    onChange={(e) =>
                      patch({ mailingZip: e.target.value.replace(/\D/g, "").slice(0, 5) })
                    }
                    inputMode="numeric"
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ── Step 2: Household and tax ──────────────────────────────────── */}
      {step === 2 ? (
        <Card>
          <CardHeader title="Tax household" hint="Filing intent drives eligibility for the credit." />
          <div className="space-y-4 px-4 pb-4">
            {/* Pre-filled from the people on the form rather than left blank —
                the agent was typing the same number twice. Still editable: a
                TAX household can include someone not applying, or exclude a
                member who files separately. */}
            <Field
              label="Household size"
              hint="Everyone on the tax return, not just those applying."
            >
              <TextInput
                value={draft.householdSize ?? effectiveHouseholdSize(draft)}
                onChange={(e) =>
                  patch({ householdSize: e.target.value === "" ? null : Number(e.target.value) })
                }
                inputMode="numeric"
              />
            </Field>
            <Field label="Will file taxes for the coverage year">
              <Toggle
                value={draft.willFileTaxes === "" ? null : draft.willFileTaxes === "Yes"}
                onChange={(v) => patch({ willFileTaxes: v ? "Yes" : "No" })}
              />
            </Field>
            <Field label="Filing jointly">
              <Toggle
                value={draft.fileJointly === "" ? null : draft.fileJointly === "Yes"}
                onChange={(v) => patch({ fileJointly: v ? "Yes" : "No" })}
              />
            </Field>
            <Field label="US citizen">
              <Toggle
                value={draft.usCitizen === "" ? null : draft.usCitizen === "Yes"}
                onChange={(v) => patch({ usCitizen: v ? "Yes" : "No" })}
              />
            </Field>

            {/* Only asked of a citizen — it is the follow-up the application
                itself shows conditionally. */}
            {/* "Naturalized or derived citizen" is jargon, and answering it
                wrong is not harmless: a Yes makes the exchange ask for
                citizenship paperwork, which delays the enrollment for someone
                who never needed to provide any. So the question is asked in
                plain words, framed the way it actually applies — born here is
                the common case — and the consequence is stated. */}
            {draft.usCitizen === "Yes" ? (
              <Field label="Were they born in the United States?">
                <Toggle
                  value={
                    draft.naturalizedOrDerived === ""
                      ? null
                      : draft.naturalizedOrDerived === "No"
                  }
                  labels={["Born in the US", "Became a citizen later"]}
                  /* Inverted on purpose: the field records "naturalized or
                     derived", which is the opposite of "born here". Asking the
                     question the way a person understands it and translating
                     once, here, beats asking the jargon version. */
                  onChange={(bornInUs) =>
                    patch({ naturalizedOrDerived: bornInUs ? "No" : "Yes" })
                  }
                />
              </Field>
            ) : null}

            {draft.naturalizedOrDerived === "Yes" ? (
              <p className="flex items-start gap-2 rounded-xl bg-navy-50 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-navy-100">
                <AlertCircle size={15} className="mt-0.5 shrink-0 text-navy-600" aria-hidden />
                <span>
                  Because they became a citizen rather than being born here, the exchange will
                  ask for a document — a naturalization certificate, certificate of citizenship,
                  or US passport. Only answer this way if that is genuinely the case.
                </span>
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}

      {/* ── Step 3, continued: eligibility ─────────────────────────────── */}
      {step === 2 ? (
        <Card>
          <CardHeader
            title="Eligibility questions"
            hint="The exchange asks all of these. The office chases whatever is left blank."
          />
          <div className="space-y-4 px-4 pb-4">
            <PickField
              label="Currently incarcerated"
              choices={PL.INCARCERATED}
              value={draft.incarcerated}
              onChange={(incarcerated) => patch({ incarcerated })}
            />
            <PickField
              label="American Indian or Alaska Native"
              choices={PL.AMERICAN_INDIAN_AK_NATIVE}
              value={draft.americanIndianAkNative}
              onChange={(americanIndianAkNative) => patch({ americanIndianAkNative })}
              hint="Changes cost-sharing and enrollment windows, so it is worth asking."
            />
            <PickField
              label="Wants to check for cost savings"
              choices={PL.YES_NO}
              value={draft.wantsCostSavings}
              onChange={(wantsCostSavings) => patch({ wantsCostSavings })}
              hint="Saying no skips the income questions and forfeits any tax credit."
            />
            <PickField
              label="On Medicare Part A or C, now or within 3 months"
              choices={PL.YES_NO}
              value={draft.medicareEnrolledOrSoon}
              onChange={(medicareEnrolledOrSoon) => patch({ medicareEnrolledOrSoon })}
            />
            <PickField
              label="Will be claimed as a tax dependent by someone else"
              choices={PL.YES_NO}
              value={draft.claimedAsDependent}
              onChange={(claimedAsDependent) => patch({ claimedAsDependent })}
            />
            <PickField
              label="Cares for a child under 19 who is not on this application"
              choices={PL.YES_NO}
              value={draft.caresForUnder19}
              onChange={(caresForUnder19) => patch({ caresForUnder19 })}
            />
            <PickField
              label="Denied Medicaid or CHIP in the last 90 days"
              choices={PL.MEDICAID_CHIP_DENIED_90D}
              value={draft.medicaidChipDenied90d}
              onChange={(medicaidChipDenied90d) => patch({ medicaidChipDenied90d })}
            />
          </div>
        </Card>
      ) : null}

      {/* ── Step 3: Income ─────────────────────────────────────────────── */}
      {step === 3 ? (
        <Card>
          <CardHeader
            title="Income"
            hint="A wrong digit here is the difference between an enrollment that processes and one that bounces."
          />
          <div className="space-y-3 px-4 pb-4">
            <Field label="Annual household income">
              <TextInput
                value={draft.householdIncome ?? ""}
                onChange={(e) =>
                  patch({ householdIncome: e.target.value === "" ? null : Number(e.target.value) })
                }
                inputMode="numeric"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employment income">
                <TextInput
                  value={draft.employmentIncome ?? ""}
                  onChange={(e) =>
                    patch({ employmentIncome: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  inputMode="numeric"
                />
              </Field>
              <Field label="Spouse employment">
                <TextInput
                  value={draft.spouseEmploymentIncome ?? ""}
                  onChange={(e) =>
                    patch({
                      spouseEmploymentIncome: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  inputMode="numeric"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Other income">
                <TextInput
                  value={draft.otherIncome ?? ""}
                  onChange={(e) =>
                    patch({ otherIncome: e.target.value === "" ? null : Number(e.target.value) })
                  }
                  inputMode="numeric"
                />
              </Field>
              <Field label="Employer">
                <TextInput
                  value={draft.employer}
                  onChange={(e) => patch({ employer: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </Card>
      ) : null}

      {/* ── Step 4: Existing coverage and SEP ──────────────────────────── */}
      {step === 4 ? (
        <Card>
          <CardHeader
            title="Existing coverage and enrollment event"
            hint="Outside open enrollment, the qualifying event is what makes the application valid."
          />
          <div className="space-y-3 px-4 pb-4">
            <Field label="Has coverage now">
              <Toggle
                value={draft.existingCoverage === "" ? null : draft.existingCoverage === "Yes"}
                onChange={(v) => patch({ existingCoverage: v ? "Yes" : "No" })}
              />
            </Field>
            {draft.existingCoverage === "Yes" ? (
              <>
                {/* Options come from PL, not typed here: the previous list
                    offered Employer / Marketplace / COBRA / Other, none of
                    which are on Zoho's picklist, so every one of them was
                    silently dropped on save. */}
                <PickField
                  label="Type of coverage"
                  choices={PL.TYPE_OF_EXISTING_COVERAGE}
                  value={draft.typeOfExistingCoverage}
                  onChange={(typeOfExistingCoverage) => patch({ typeOfExistingCoverage })}
                />
                <Field label="Coverage loss date" hint="Leave blank if it is not ending.">
                  <TextInput
                    type="date"
                    value={draft.coverageLossDate}
                    onChange={(e) => patch({ coverageLossDate: e.target.value })}
                  />
                </Field>
              </>
            ) : null}

            <PickField
              label="Enrollment type"
              choices={PL.ENROLLMENT_TYPE}
              value={draft.enrollmentType}
              onChange={(enrollmentType) => patch({ enrollmentType })}
              hint="Open Enrollment unless a qualifying event applies."
            />

            {draft.enrollmentType === "Special Enrollment" ? (
              <>
                {/* All 28 of HealthSherpa's event types, grouped — a flat list
                    that long is unusable on a phone. Picking the specific
                    event saves the office working it out from a note. */}
                <Field label="Qualifying event">
                  <Select
                    value={draft.enrollmentEvent}
                    onChange={(e) => patch({ enrollmentEvent: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {ENROLLMENT_EVENT_GROUPS.map((group) => (
                      <optgroup key={group.title} label={group.title}>
                        {group.events.map((ev) => (
                          <option key={ev.hs} value={ev.label}>
                            {ev.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                </Field>
                <Field label="Event date">
                  <TextInput
                    type="date"
                    value={draft.qualifyingEventDate}
                    onChange={(e) => patch({ qualifyingEventDate: e.target.value })}
                  />
                </Field>

                {/* Advisory, not blocking: the 60-day window has exceptions,
                    and a form the office can chase beats one the agent could
                    not submit. */}
                {outsideSixtyDayWindow(draft.enrollmentEvent, draft.qualifyingEventDate) ? (
                  <p className="flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-warning/20">
                    <AlertCircle size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
                    That is more than 60 days ago. Most qualifying events have a 60-day window —
                    the office will need to check this one.
                  </p>
                ) : null}
              </>
            ) : null}

            <PickField
              label="Offered coverage through a job"
              choices={PL.EMPLOYER_COVERAGE_OFFER}
              value={draft.employerCoverageOffer}
              onChange={(employerCoverageOffer) => patch({ employerCoverageOffer })}
            />
            <PickField
              label="ICHRA"
              choices={PL.ICHRA_STATUS}
              value={draft.ichraStatus}
              onChange={(ichraStatus) => patch({ ichraStatus })}
            />
            <PickField
              label="Filed Form 8962 to reconcile past tax credits"
              choices={PL.FORM_8962_FILED}
              value={draft.form8962Filed}
              onChange={(form8962Filed) => patch({ form8962Filed })}
              hint="Only matters if they got a premium tax credit before."
            />
          </div>
        </Card>
      ) : null}

      {/* ── Step 5: Review and submit ──────────────────────────────────── */}
      {step === 5 ? (
        <div className="space-y-4">
          <LicenseCapture
            document={draft.photoId}
            onChange={(photoId) => patch({ photoId })}
          />

          <ReviewSummary draft={draft} onEdit={setStep} />

          {error ? (
            <p className="mx-4 flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
              {error}
            </p>
          ) : null}

          <Inset>
            <Button onClick={submit} disabled={submitting}>
              <Send size={16} aria-hidden />
              {submitting ? "Submitting…" : "Submit to the office"}
            </Button>
          </Inset>
        </div>
      ) : null}

      {/* ── Step nav ───────────────────────────────────────────────────── */}
      {blocker ? (
        <p className="flex items-start gap-2 px-4 text-[13px] text-warning">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {blocker}
        </p>
      ) : null}

      <div className="sticky bottom-0 flex gap-2 border-t border-line bg-cream/95 px-4 pt-3 pb-3 backdrop-blur">
        <Button
          variant="secondary"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className={onReview ? "" : "!w-auto flex-1"}
        >
          <ChevronLeft size={17} aria-hidden /> Back
        </Button>
        {/* No Next on the review step. There is nowhere to go, so it could only
            ever render disabled — and a dead primary button sitting beside
            "Submit to the office" reads as a requirement the agent has not
            met yet. Submit is the forward action there. */}
        {onReview ? null : (
          <Button
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            disabled={blocker !== null}
            className="!w-auto flex-[2]"
          >
            Next <ChevronRight size={17} aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Groups fields inside a card, so "Home address" and "Mailing address" are
 *  distinguishable at a glance instead of being one run of inputs. */
function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="pt-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{children}</p>
  );
}

/**
 * A select built from a pinned Zoho picklist.
 *
 * Options always come from lib/picklists.ts rather than being typed inline —
 * typing them inline is exactly how three fields ended up offering values Zoho
 * silently discarded on save.
 */
function PickField({
  label,
  choices,
  value,
  onChange,
  hint,
}: {
  label: string;
  choices: PL.Choice[];
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}

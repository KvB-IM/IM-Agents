"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Send, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import { useDraft } from "@/components/DraftContext";
import PersonEditor from "@/components/PersonEditor";
import { Card, CardHeader, Field, TextInput, Select, Toggle, Button, Badge, Empty, Inset } from "@/components/ui";
import { money, monthYear } from "@/lib/format";
import { ssnConfirmed, ssnDigits } from "@/lib/ssn";
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

export default function CapturePage() {
  const router = useRouter();
  const { draft, patch, patchPerson, loaded, reset } = useDraft();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Jot | null>(null);

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
    } catch {
      setError("No connection. The application is saved — try again when you have signal.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) return null;

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

  return (
    <div className="space-y-4">
      {/* ── Stepper ────────────────────────────────────────────────────── */}
      <Inset>
        <div className="flex items-baseline justify-between">
          <h1 className="text-[22px] font-bold tracking-tight text-navy-900">Application</h1>
          <span className="text-[12px] font-medium text-muted">
            {step + 1} of {STEPS.length}
          </span>
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
          <CardHeader title="Address and contact" hint="Permanent address, as the exchange has it." />
          <div className="space-y-3 px-4 pb-4">
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
          </div>
        </Card>
      ) : null}

      {/* ── Step 2: Household and tax ──────────────────────────────────── */}
      {step === 2 ? (
        <Card>
          <CardHeader title="Tax household" hint="Filing intent drives eligibility for the credit." />
          <div className="space-y-4 px-4 pb-4">
            <Field label="Household size">
              <TextInput
                value={draft.householdSize ?? ""}
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
            {draft.usCitizen === "Yes" ? (
              <Field label="Naturalized or derived citizen">
                <Toggle
                  value={
                    draft.naturalizedOrDerived === ""
                      ? null
                      : draft.naturalizedOrDerived === "Yes"
                  }
                  onChange={(v) => patch({ naturalizedOrDerived: v ? "Yes" : "No" })}
                />
              </Field>
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
              label="Pregnant"
              choices={PL.PREGNANT}
              value={draft.pregnant}
              onChange={(pregnant) => patch({ pregnant })}
            />
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
          <Card>
            <CardHeader title="Review" hint="What the office will receive." />
            <dl className="divide-y divide-line px-4 pb-2">
              {[
                ["Applicant", [primary?.firstName, primary?.lastName].filter(Boolean).join(" ") || "—"],
                ["Date of birth", primary?.dateOfBirth || "—"],
                ["Household", String(draft.householdSize ?? draft.people.length)],
                ["Members on form", String(draft.people.length)],
                ["County", draft.county ? `${draft.county.name}, ${draft.county.state}` : "—"],
                ["Income", draft.householdIncome === null ? "—" : money(draft.householdIncome)],
                ["Plan", draft.selectedPlan.planName],
                ["Carrier", draft.selectedPlan.carrier],
                ["Premium", money(draft.selectedPlan.premium)],
                ["Net to client", money(draft.selectedPlan.netPremium)],
                ["Effective", monthYear(draft.requestedEffective)],
                ["Enrollment type", draft.enrollmentType || "—"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[13px] text-muted">{k}</dt>
                  <dd className="text-right text-[13px] font-medium text-navy-900">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <div className="mx-4 rounded-xl bg-white px-3.5 py-3 ring-1 ring-line">
            <div className="flex items-center gap-2">
              <Badge tone="gold">Credited to</Badge>
              <span className="text-[13px] font-medium text-navy-900">you</span>
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-muted">
              You go on this form as the accredited field agent. The enrolling agent of record is
              set by the office, not here.
            </p>
          </div>

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
          className="!w-auto flex-1"
        >
          <ChevronLeft size={17} aria-hidden /> Back
        </Button>
        <Button
          onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
          disabled={step === STEPS.length - 1 || blocker !== null}
          className="!w-auto flex-[2]"
        >
          Next <ChevronRight size={17} aria-hidden />
        </Button>
      </div>
    </div>
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

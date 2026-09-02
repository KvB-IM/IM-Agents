"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { ssnDigits, maskedSsn, ssnProblem, ssnConfirmed, applySsnInput } from "@/lib/ssn";
import { Field, TextInput } from "./ui";

/**
 * SSN entry, masked, with a confirmation box.
 *
 * The number is never fully legible on screen: each digit is replaced with a
 * dot as soon as the next one is typed, so only the most recent keystroke
 * shows. That is deliberately not full masking — entering nine digits
 * completely blind on a touch keyboard is how a transposed pair survives all
 * the way to the carrier, and a bounced application costs the client their
 * coverage date.
 *
 * The confirmation box is the actual protection against a typo. It is checked
 * against the first entry on the digits, not the display, and the step will not
 * advance until they match.
 *
 * The underlying <input> holds the MASKED string, and keystrokes are applied to
 * the real value held in the parent. That means the true SSN is never in the
 * DOM, so it cannot be read out of the element, restored by autofill, or
 * captured in a screen recording of the field.
 */
export default function SsnInput({
  label,
  value,
  confirmValue,
  noSsn,
  onChange,
  onConfirmChange,
  onNoSsnChange,
  required = true,
}: {
  label: string;
  value: string;
  confirmValue: string;
  noSsn: boolean;
  onChange: (digits: string) => void;
  onConfirmChange: (digits: string) => void;
  onNoSsnChange: (v: boolean) => void;
  required?: boolean;
}) {
  // Only complain once they have left the field. Showing "an SSN is required"
  // on an untouched form is noise, not help. The confirmation box needs no
  // such guard — divergence is reported at the keystroke, which is the point.
  const [touched, setTouched] = useState(false);

  const digits = ssnDigits(value);
  const confirmDigits = ssnDigits(confirmValue);
  const problem = ssnProblem(digits);
  const matched = ssnConfirmed(digits, confirmDigits);

  /**
   * Diverged, rather than merely incomplete.
   *
   * Flagged as soon as the confirmation stops being a prefix of the first
   * entry, so a wrong digit is caught at the keystroke rather than after all
   * nine — which on a masked field is the difference between fixing one digit
   * and retyping the lot. A shorter-but-matching entry is just unfinished and
   * says nothing.
   */
  const diverged = confirmDigits.length > 0 && !digits.startsWith(confirmDigits);

  /* Keystroke interpretation lives in lib/ssn.ts, where it is unit-tested —
   * it is a delta against the rendered mask rather than a plain read of the
   * field, and getting it wrong silently caps the number at two digits. */
  const handle = (raw: string, current: string, apply: (d: string) => void) =>
    apply(applySsnInput(raw, current));

  /* Attested as never issued: the number is not required and the boxes are
     not shown at all. Leaving them visible-but-disabled invites an agent to
     type into a dead field and wonder why nothing happens. */
  if (noSsn) {
    return (
      <div className="space-y-2">
        <NoSsnToggle checked onChange={onNoSsnChange} />
        <p className="text-[12px] leading-snug text-muted">
          The exchange will accept the attestation instead of a number. Only use this when the
          person has genuinely never been issued an SSN.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Field
        label={label}
        error={touched && required && problem ? problem : undefined}
      >
        <TextInput
          value={maskedSsn(digits)}
          onChange={(e) => handle(e.target.value, value, onChange)}
          onBlur={() => setTouched(true)}
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="000-00-0000"
          aria-label={label}
        />
      </Field>

      <Field
        label={`Re-enter ${label}`}
        error={diverged ? "These do not match." : undefined}
      >
        <div className="relative">
          <TextInput
            value={maskedSsn(confirmDigits)}
            onChange={(e) => handle(e.target.value, confirmValue, onConfirmChange)}
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="000-00-0000"
            aria-label={`Re-enter ${label}`}
            className={matched ? "pr-10 border-success" : "pr-10"}
          />
          {matched ? (
            <span className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-success">
              <Check size={17} strokeWidth={3} aria-label="matches" />
            </span>
          ) : null}
        </div>
      </Field>

      <NoSsnToggle checked={false} onChange={onNoSsnChange} />
    </div>
  );
}

/**
 * The never-issued attestation.
 *
 * Wording taken from HealthSherpa's own screen rather than paraphrased — it is
 * an attestation the applicant makes, and softening it would misrepresent what
 * ticking the box means.
 */
function NoSsnToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-navy-50 px-3 py-2.5 ring-1 ring-navy-100">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-5 shrink-0 rounded border-line accent-navy-900"
      />
      <span className="text-[12px] leading-snug text-navy-900">
        This person has never been issued an SSN by the Social Security Administration.
      </span>
    </label>
  );
}

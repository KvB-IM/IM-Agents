"use client";

import { Trash2 } from "lucide-react";
import type { Person } from "@/lib/types";
import { ageAt } from "@/lib/age";
import { Field, TextInput, Select, Toggle, Badge } from "./ui";

const RELATION_LABEL: Record<Person["relation"], string> = {
  primary: "Primary applicant",
  spouse: "Spouse",
  child: "Child",
  other: "Other",
};

/**
 * One household member.
 *
 * Captures DATE OF BIRTH, and shows the derived age beside it. The Jot needs
 * DoB and HealthSherpa rates on age at the effective date, so asking for age
 * would mean asking twice and letting the two drift. Showing the derived age
 * is also how an agent catches a mistyped year immediately — a 1996/1966 slip
 * is invisible as a date and obvious as an age.
 */
export default function PersonEditor({
  person,
  effectiveDate,
  onChange,
  onRemove,
  showSsn,
}: {
  person: Person;
  effectiveDate: string;
  onChange: (p: Partial<Person>) => void;
  onRemove?: () => void;
  showSsn?: boolean;
}) {
  const age = ageAt(person.dateOfBirth, effectiveDate);

  return (
    <div className="border-t border-line px-4 py-4 first:border-t-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={person.relation === "primary" ? "gold" : "neutral"}>
            {RELATION_LABEL[person.relation]}
          </Badge>
          {age !== null ? (
            <span className="text-[12px] text-muted">
              age {age} at {effectiveDate.slice(5, 7)}/{effectiveDate.slice(0, 4)}
            </span>
          ) : null}
        </div>
        {onRemove && person.relation !== "primary" ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${RELATION_LABEL[person.relation]}`}
            className="tap -mr-2 flex w-11 items-center justify-center rounded-lg text-muted active:bg-navy-50 active:text-error"
          >
            <Trash2 size={18} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <TextInput
            value={person.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            autoComplete="off"
            autoCapitalize="words"
          />
        </Field>
        <Field label="Last name">
          <TextInput
            value={person.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            autoComplete="off"
            autoCapitalize="words"
          />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Date of birth">
          <TextInput
            type="date"
            value={person.dateOfBirth}
            onChange={(e) => onChange({ dateOfBirth: e.target.value })}
          />
        </Field>
        <Field label="Sex">
          <Select
            value={person.sex}
            onChange={(e) => onChange({ sex: e.target.value as Person["sex"] })}
          >
            <option value="">Select…</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
          </Select>
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Uses tobacco">
          <Toggle value={person.tobacco} onChange={(v) => onChange({ tobacco: v })} />
        </Field>
        <Field label="Needs coverage">
          <Toggle
            value={person.seekingCoverage}
            onChange={(v) => onChange({ seekingCoverage: v })}
          />
        </Field>
      </div>

      {showSsn ? (
        <div className="mt-3">
          <Field
            label="SSN"
            hint="Submitted, never shown again. Re-collect it if a correction is needed."
          >
            <TextInput
              value={person.ssn}
              onChange={(e) => onChange({ ssn: e.target.value })}
              inputMode="numeric"
              autoComplete="off"
              placeholder="000-00-0000"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

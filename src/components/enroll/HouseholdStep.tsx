"use client";

import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { useDraft } from "@/components/DraftContext";
import PersonEditor from "@/components/PersonEditor";
import { Card, CardHeader, Field, TextInput, Select, Button } from "@/components/ui";
import { effectiveDateOptions } from "@/lib/age";
import { monthYear } from "@/lib/format";
import type { County } from "@/lib/types";

/**
 * Step 1 of Enroll: where, who, how much.
 *
 * This was the quote page. It asks nothing that identifies the client beyond
 * names and dates of birth — no SSN, no contact — because it has to be usable
 * for someone who is only shopping. A price comes before identity; the fields
 * that identify are on Essentials, after the plan is picked.
 *
 * Every input stays reachable on one screen rather than split further: an
 * agent runs this at a kitchen table while the client changes their mind
 * about who is on the policy.
 */
export default function HouseholdStep() {
  const { draft, patch, patchPerson, addPerson, removePerson } = useDraft();
  const [counties, setCounties] = useState<County[]>([]);
  const [countyLoading, setCountyLoading] = useState(false);
  const covered = draft.people.filter((p) => p.seekingCoverage);

  // ── County lookup ────────────────────────────────────────────────────────
  // Fires as soon as the ZIP is five digits. A ZIP can span several counties
  // and quoting needs a single FIPS code, so this cannot be skipped.
  useEffect(() => {
    if (!/^\d{5}$/.test(draft.zip)) {
      setCounties([]);
      return;
    }
    let cancelled = false;
    setCountyLoading(true);
    fetch(`/api/hs/counties?zip_code=${draft.zip}`)
      .then((r) => r.json())
      .then((d: { counties?: County[]; error?: string }) => {
        if (cancelled) return;
        const list = d.counties ?? [];
        setCounties(list);
        // Only one county: pick it, and never make the agent tap a list of one.
        if (list.length === 1) patch({ county: list[0] });
      })
      .catch(() => {
        if (!cancelled) setCounties([]);
      })
      .finally(() => {
        if (!cancelled) setCountyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [draft.zip, patch]);


  return (
    <div className="space-y-4">
      {/* ── Where ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Where they live" hint="Rates are set by county, not by ZIP." />
        <div className="space-y-3 px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ZIP code">
              <TextInput
                value={draft.zip}
                onChange={(e) => {
                  const zip = e.target.value.replace(/\D/g, "").slice(0, 5);
                  patch({ zip, county: null });
                }}
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="85201"
              />
            </Field>
            <Field label="Effective date">
              <Select
                value={draft.requestedEffective}
                onChange={(e) => patch({ requestedEffective: e.target.value })}
              >
                {effectiveDateOptions(4).map((d) => (
                  <option key={d} value={d}>
                    {monthYear(d)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {countyLoading ? (
            <p className="text-[13px] text-muted">Looking up counties…</p>
          ) : counties.length > 1 ? (
            <Field label="County" hint="This ZIP spans more than one county.">
              <Select
                value={draft.county?.fipsCode ?? ""}
                onChange={(e) =>
                  patch({ county: counties.find((c) => c.fipsCode === e.target.value) ?? null })
                }
              >
                <option value="">Select a county…</option>
                {counties.map((c) => (
                  <option key={c.fipsCode} value={c.fipsCode}>
                    {c.name} County, {c.state}
                  </option>
                ))}
              </Select>
            </Field>
          ) : draft.county ? (
            <p className="text-[13px] text-muted">
              {draft.county.name} County, {draft.county.state}
              <span className="text-muted/60"> · FIPS {draft.county.fipsCode}</span>
            </p>
          ) : null}
        </div>
      </Card>

      {/* ── Who ────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Who needs coverage"
          hint="Dates of birth, not ages — the application needs the date."
        />
        <div>
          {draft.people.map((person) => (
            <PersonEditor
              key={person.key}
              person={person}
              effectiveDate={draft.requestedEffective}
              onChange={(p) => patchPerson(person.key, p)}
              onRemove={() => removePerson(person.key)}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-line p-4">
          <Button variant="secondary" onClick={() => addPerson("spouse")}>
            <UserPlus size={16} aria-hidden /> Spouse
          </Button>
          <Button variant="secondary" onClick={() => addPerson("child")}>
            <UserPlus size={16} aria-hidden /> Child
          </Button>
        </div>
      </Card>

      {/* ── Income ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Household and income"
          hint="Annual household income drives the tax credit. Estimate it now; correct it on the application."
        />
        <div className="grid grid-cols-2 gap-3 px-4 pb-4">
          <Field label="Household size" hint="Everyone on the tax return.">
            <TextInput
              value={draft.householdSize ?? ""}
              onChange={(e) =>
                patch({ householdSize: e.target.value === "" ? null : Number(e.target.value) })
              }
              inputMode="numeric"
              placeholder={String(covered.length || 1)}
            />
          </Field>
          <Field label="Annual income">
            <TextInput
              value={draft.householdIncome ?? ""}
              onChange={(e) =>
                patch({ householdIncome: e.target.value === "" ? null : Number(e.target.value) })
              }
              inputMode="numeric"
              placeholder="48000"
            />
          </Field>
        </div>
      </Card>

    </div>
  );
}

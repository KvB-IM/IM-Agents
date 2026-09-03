"use client";

import { useState } from "react";
import { Search, X, Loader2, AlertCircle, Pill, Stethoscope } from "lucide-react";
import type { CoverageStatus } from "@/lib/cmsCoverage.ts";
import { Card, CardHeader, Select, TextInput, Button } from "./ui";

/**
 * "Is my drug covered? Is my doctor in network?"
 *
 * The two questions an agent gets asked at every kitchen table, and the two
 * HealthSherpa cannot answer — `/v1/quotes` has no filter for either. CMS
 * publishes both, keyed on the HIOS plan id the quote already returns, so the
 * answer lands on the plans we are already showing.
 *
 * Everything here degrades to nothing. If the lookup is unconfigured, the key
 * has expired, or CMS is down, the plan list renders exactly as before: this is
 * an enhancement to a quote, never a precondition for one.
 */

export interface CheckedDrug {
  rxcui: string;
  label: string;
}
export interface CheckedProvider {
  npi: string;
  label: string;
}

interface DrugHit {
  rxcui: string;
  name: string;
  strength: string;
  route: string;
}
interface ProviderHit {
  npi: string;
  name: string;
  city: string;
  state: string;
  specialties: string[];
  distance: number | null;
}

export default function CoverageCheck({
  year,
  zip,
  drugs,
  providers,
  onChange,
  busy,
  error,
  yearUsed,
  noDrugData,
  noProviderData,
}: {
  year: number;
  zip: string;
  drugs: CheckedDrug[];
  providers: CheckedProvider[];
  onChange: (next: { drugs: CheckedDrug[]; providers: CheckedProvider[] }) => void;
  busy: boolean;
  error: string | null;
  /** The plan year CMS answered from, once a check has run. */
  yearUsed: number | null;
  /** True when NO plan in this market published the relevant data. */
  noDrugData: boolean;
  noProviderData: boolean;
}) {
  const [mode, setMode] = useState<"drug" | "provider">("drug");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"Individual" | "Facility">("Individual");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [drugHits, setDrugHits] = useState<DrugHit[] | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [searchYearUsed, setSearchYearUsed] = useState<number | null>(null);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [providerHits, setProviderHits] = useState<ProviderHit[] | null>(null);

  async function run(term?: string) {
    const q = (term ?? query).trim();
    if (term !== undefined) setQuery(term);
    if (q.length < 3) {
      setSearchError("Type at least three letters.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    setDrugHits(null);
    setProviderHits(null);
    setSuggestions([]);
    setSearchTotal(null);
    try {
      const params = new URLSearchParams({ kind: mode, q, year: String(year) });
      if (mode === "provider") {
        params.set("zip", zip);
        params.set("type", kind);
      }
      const res = await fetch(`/api/cms/search?${params}`);
      const data = (await res.json()) as {
        drugs?: DrugHit[];
        providers?: ProviderHit[];
        suggestions?: string[];
        yearUsed?: number;
        total?: number;
        error?: string;
      };
      if (!res.ok) {
        setSearchError(data.error ?? "That search failed.");
        return;
      }
      setSearchYearUsed(data.yearUsed ?? null);
      setSearchTotal(typeof data.total === "number" ? data.total : null);
      if (mode === "drug") {
        setDrugHits(data.drugs ?? []);
        setSuggestions(data.suggestions ?? []);
      } else {
        setProviderHits(data.providers ?? []);
      }
    } catch {
      setSearchError("No connection. The plans above are unaffected.");
    } finally {
      setSearching(false);
    }
  }

  const addDrug = (hit: DrugHit) => {
    const label = [hit.name, hit.strength].filter(Boolean).join(" ");
    if (!drugs.some((d) => d.rxcui === hit.rxcui)) {
      onChange({ drugs: [...drugs, { rxcui: hit.rxcui, label }], providers });
    }
    setDrugHits(null);
    setSuggestions([]);
    setQuery("");
  };

  const addProvider = (hit: ProviderHit) => {
    if (!providers.some((p) => p.npi === hit.npi)) {
      onChange({ drugs, providers: [...providers, { npi: hit.npi, label: hit.name }] });
    }
    setProviderHits(null);
    setQuery("");
  };

  const chosen = drugs.length + providers.length;

  return (
    <Card>
      <CardHeader
        title="Check a drug or doctor"
        hint="Answers come from what the carrier published with CMS, so it is a guide, not a guarantee. Some carriers publish nothing, which shows as “not published” rather than “not covered”."
      />

      <div className="space-y-3 px-4 pb-4">
        {chosen > 0 ? (
          <div className="flex flex-wrap gap-2">
            {drugs.map((d) => (
              <Chip
                key={d.rxcui}
                icon={<Pill size={12} aria-hidden />}
                label={d.label}
                onRemove={() =>
                  onChange({ drugs: drugs.filter((x) => x.rxcui !== d.rxcui), providers })
                }
              />
            ))}
            {providers.map((p) => (
              <Chip
                key={p.npi}
                icon={<Stethoscope size={12} aria-hidden />}
                label={p.label}
                onRemove={() =>
                  onChange({ drugs, providers: providers.filter((x) => x.npi !== p.npi) })
                }
              />
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          {(["drug", "provider"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setDrugHits(null);
                setProviderHits(null);
                setSearchError(null);
              }}
              aria-pressed={mode === m}
              className={`tap rounded-xl px-3 text-[14px] font-medium transition-colors ${
                mode === m
                  ? "bg-navy-900 text-white"
                  : "bg-white text-navy-700 ring-1 ring-line active:bg-navy-50"
              }`}
            >
              {m === "drug" ? "Drug" : "Doctor"}
            </button>
          ))}
        </div>

        {mode === "provider" ? (
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="Individual">A person</option>
            <option value="Facility">A hospital or clinic</option>
          </Select>
        ) : null}

        <div className="flex gap-2">
          <TextInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void run();
              }
            }}
            placeholder={mode === "drug" ? "Metformin" : "Banner"}
            autoCapitalize="off"
            autoComplete="off"
            className="flex-1"
          />
          <Button
            variant="secondary"
            onClick={() => void run()}
            disabled={searching}
            className="!w-auto shrink-0 px-4"
          >
            {searching ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : (
              <Search size={16} aria-hidden />
            )}
          </Button>
        </div>

        {searchError ? (
          <p className="flex items-start gap-2 text-[12px] leading-snug text-error">
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {searchError}
          </p>
        ) : null}

        {/* CMS wants the COMPLETE, correctly spelled name — a partial word is
            unreliable and a typo returns nothing at all — so the advice is to
            type the whole thing rather than to try harder. */}
        {/* Says when the list is a slice of something much larger. A provider
            name like "Smith" matches 12,701 people near one ZIP; showing the
            hundred nearest without saying so invites picking the wrong one. */}
        {(drugHits && drugHits.length > 0) || (providerHits && providerHits.length > 0) ? (
          <p className="text-[12px] leading-snug text-muted">
            {(() => {
              const shown = drugHits?.length ?? providerHits?.length ?? 0;
              const truncated = searchTotal !== null && searchTotal > shown;
              if (!truncated) {
                return `${shown} match${shown === 1 ? "" : "es"} — ${
                  mode === "drug" ? "closest name first" : "nearest first"
                }.`;
              }
              return `Nearest ${shown} of ${searchTotal.toLocaleString()} — add a first name to narrow it.`;
            })()}
          </p>
        ) : null}

        {drugHits?.length === 0 || providerHits?.length === 0 ? (
          <p className="text-[12px] leading-snug text-muted">
            {mode === "drug"
              ? "No match. Type the drug's full name — a partial word or a typo finds nothing."
              : "Nothing found. Try a surname, or a shorter name."}
          </p>
        ) : null}

        {/* Offered, never applied. "metfromin" suggests merbromin — an
            antiseptic dye — ahead of metformin, so the agent picks. */}
        {suggestions.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[12px] font-medium text-navy-800">Did you mean</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((sugg) => (
                <button
                  key={sugg}
                  type="button"
                  onClick={() => void run(sugg)}
                  className="tap-none rounded-full bg-white px-3 py-1 text-[13px] font-semibold text-navy-800 ring-1 ring-line active:bg-navy-50"
                >
                  {sugg}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Results are a list of exact products — "Metformin 500 mg" is a
            different formulary entry from "Metformin XR 500 mg", and picking
            the wrong one answers a question the client did not ask. */}
        {/* Scrolls rather than truncating. It was capped at 12 with nothing
            saying so, which for "insulin" — 140 products in the catalogue, 40
            returned after ranking — looked like the search only half worked.
            The ranking puts the likely product at the top; the rest are still
            reachable. */}
        {drugHits && drugHits.length > 0 ? (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
            {drugHits.map((hit) => (
              <li key={hit.rxcui}>
                <button
                  type="button"
                  onClick={() => addDrug(hit)}
                  className="tap-none w-full px-3 py-2.5 text-left active:bg-navy-50"
                >
                  <p className="text-[13px] font-medium text-navy-900">
                    {hit.name} {hit.strength}
                  </p>
                  <p className="text-[12px] text-muted">{hit.route}</p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {providerHits && providerHits.length > 0 ? (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
            {providerHits.map((hit) => (
              <li key={hit.npi}>
                <button
                  type="button"
                  onClick={() => addProvider(hit)}
                  className="tap-none w-full px-3 py-2.5 text-left active:bg-navy-50"
                >
                  <p className="text-[13px] font-medium text-navy-900">{hit.name}</p>
                  <p className="text-[12px] text-muted">
                    {[
                      hit.specialties[0],
                      hit.city && hit.state ? `${hit.city}, ${hit.state}` : null,
                      hit.distance !== null ? `${Math.round(hit.distance)} mi` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Said plainly rather than hidden. CMS publishes formularies for a
            plan year, and during open enrollment an agent quoting a January
            effective date is asking about a year that does not exist yet — so
            the answer comes from the current year's lists, and passing that off
            as next year's would be the quiet kind of wrong. */}
        {(yearUsed ?? searchYearUsed) !== null && (yearUsed ?? searchYearUsed) !== year ? (
          <p className="flex items-start gap-2 rounded-xl bg-navy-50 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-navy-100">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-navy-600" aria-hidden />
            <span>
              CMS has not published {year} drug and network lists yet, so these answers come from{" "}
              {yearUsed ?? searchYearUsed}. Most carriers carry the same drugs year to year, but
              check with the carrier before promising anything for {year}.
            </span>
          </p>
        ) : null}

        {/* Said once, at the top, rather than as a grey badge repeated on every
            card. Georgia is the real case: all five issuers return
            DataNotProvided for every provider, so a doctor search there returns
            97 identical shrugs. The carrier's own directory is the answer. */}
        {!busy && noProviderData ? (
          <p className="flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-warning/25">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              No carrier in this area has published its provider network to CMS, so doctors
              cannot be checked here. Use the <strong>Find a doctor</strong> link on a plan
              instead.
            </span>
          </p>
        ) : null}

        {!busy && noDrugData ? (
          <p className="flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-warning/25">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            <span>
              No carrier in this area has published a drug list to CMS. Use the{" "}
              <strong>Drug list</strong> link on a plan instead.
            </span>
          </p>
        ) : null}

        {busy ? (
          <p className="flex items-center gap-2 text-[12px] text-muted">
            <Loader2 size={14} className="animate-spin" aria-hidden />
            Checking every plan…
          </p>
        ) : null}

        {error ? (
          <p className="flex items-start gap-2 rounded-xl bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-warning/25">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-warning" aria-hidden />
            {error} The plans and prices above are unaffected.
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function Chip({
  icon,
  label,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-navy-50 py-1 pl-2.5 pr-1 text-[12px] font-medium text-navy-800 ring-1 ring-navy-100">
      <span className="shrink-0 text-navy-600">{icon}</span>
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="tap-none flex size-5 shrink-0 items-center justify-center rounded-full text-muted active:bg-navy-100"
      >
        <X size={12} aria-hidden />
      </button>
    </span>
  );
}

export type { CoverageStatus };

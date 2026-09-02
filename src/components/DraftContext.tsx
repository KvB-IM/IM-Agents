"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { CaptureDraft, Person } from "@/lib/types";
import { defaultEffectiveDate } from "@/lib/age";

/**
 * The in-progress application.
 *
 * PROTOTYPE: held in sessionStorage so it survives navigation between the
 * quote and the application, and a reload. The real thing is a server-side
 * draft with an expiry (SOFTWARE_SCOPE.md 4.3) — an unsubmitted draft holds
 * SSNs, and sessionStorage is the wrong place for those on a shared iPad.
 */

const KEY = "im-agent-draft-v1";

export function emptyPerson(relation: Person["relation"]): Person {
  return {
    key: Math.random().toString(36).slice(2, 10),
    relation,
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    sex: "",
    tobacco: false,
    pregnant: "",
    ssn: "",
    ssnConfirm: "",
    noSsn: false,
    seekingCoverage: true,
  };
}

export function emptyDraft(): CaptureDraft {
  return {
    id: Math.random().toString(36).slice(2, 12),
    updatedAt: new Date().toISOString(),
    zip: "",
    county: null,
    street: "",
    city: "",
    mailingSameAsHome: true,
    mailingStreet: "",
    mailingCity: "",
    mailingState: "",
    mailingZip: "",
    wantsCostSavings: "",
    medicareEnrolledOrSoon: "",
    claimedAsDependent: "",
    caresForUnder19: "",
    everyoneSameAddress: "",
    people: [emptyPerson("primary")],
    householdSize: null,
    householdIncome: null,
    employmentIncome: null,
    spouseEmploymentIncome: null,
    otherIncome: null,
    employer: "",
    email: "",
    phone: "",
    homePhone: "",
    usCitizen: "",
    naturalizedOrDerived: "",
    incarcerated: "",
    americanIndianAkNative: "",
    medicaidChipDenied90d: "",
    employerCoverageOffer: "",
    ichraStatus: "",
    form8962Filed: "",
    willFileTaxes: "",
    fileJointly: "",
    existingCoverage: "",
    typeOfExistingCoverage: "",
    coverageLossDate: "",
    /* Defaulted to Open Enrollment: it is the common case, and it means the
       SEP questions stay hidden until an agent says one is needed rather than
       presenting a qualifying-event list to everyone. */
    enrollmentType: "Open Enrollment",
    enrollmentEvent: "",
    qualifyingEventDate: "",
    requestedEffective: defaultEffectiveDate(),
    selectedPlan: null,
  };
}

interface Ctx {
  draft: CaptureDraft;
  patch: (p: Partial<CaptureDraft>) => void;
  patchPerson: (key: string, p: Partial<Person>) => void;
  addPerson: (relation: Person["relation"]) => void;
  removePerson: (key: string) => void;
  reset: () => void;
  loaded: boolean;
}

const DraftCtx = createContext<Ctx | null>(null);

export function DraftProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<CaptureDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);

  // Rehydrate after mount, not during render — the server has no
  // sessionStorage and a mismatch would hydrate-error.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as CaptureDraft;
        /* Merge defaults at BOTH levels. Spreading only at the draft level left
         * people objects exactly as they were saved, so a field added to
         * Person after a draft was stored came back undefined — `ssnConfirm`
         * did exactly that. Every future field has the same problem, so the
         * fix belongs here rather than in a one-off migration. */
        const base = emptyDraft();
        setDraft({
          ...base,
          ...saved,
          people: (saved.people ?? []).map((person) => ({
            ...emptyPerson(person.relation ?? "primary"),
            ...person,
            // Keep the saved key so React identity and the SSN inputs survive.
            key: person.key ?? Math.random().toString(36).slice(2, 10),
          })),
        });
      }
    } catch {
      /* corrupt or unavailable storage: start clean rather than fail */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(KEY, JSON.stringify(draft));
    } catch {
      /* private mode or full quota: the draft still works in memory */
    }
  }, [draft, loaded]);

  const patch = useCallback((p: Partial<CaptureDraft>) => {
    setDraft((d) => ({ ...d, ...p, updatedAt: new Date().toISOString() }));
  }, []);

  const patchPerson = useCallback((key: string, p: Partial<Person>) => {
    setDraft((d) => ({
      ...d,
      people: d.people.map((person) => (person.key === key ? { ...person, ...p } : person)),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  const addPerson = useCallback((relation: Person["relation"]) => {
    setDraft((d) => ({ ...d, people: [...d.people, emptyPerson(relation)] }));
  }, []);

  const removePerson = useCallback((key: string) => {
    setDraft((d) => ({
      ...d,
      // The primary is the parent Jot record and cannot be removed.
      people: d.people.filter((p) => p.key !== key || p.relation === "primary"),
    }));
  }, []);

  const reset = useCallback(() => {
    const fresh = emptyDraft();
    setDraft(fresh);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  return (
    <DraftCtx.Provider value={{ draft, patch, patchPerson, addPerson, removePerson, reset, loaded }}>
      {children}
    </DraftCtx.Provider>
  );
}

export function useDraft(): Ctx {
  const ctx = useContext(DraftCtx);
  if (!ctx) throw new Error("useDraft must be used inside a DraftProvider.");
  return ctx;
}

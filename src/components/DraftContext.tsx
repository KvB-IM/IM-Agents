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
    ssn: "",
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
    willFileTaxes: "",
    fileJointly: "",
    existingCoverage: "",
    typeOfExistingCoverage: "",
    coverageLossDate: "",
    enrollmentType: "",
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
      if (raw) setDraft({ ...emptyDraft(), ...(JSON.parse(raw) as CaptureDraft) });
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

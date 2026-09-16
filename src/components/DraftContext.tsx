"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { CaptureDraft, Person } from "@/lib/types";
import { defaultEffectiveDate } from "@/lib/age";

/**
 * The in-progress application.
 *
 * Working copy in sessionStorage, so it survives navigation and a reload with
 * no network. MIRRORED to the server on every change (debounced), which is
 * what makes it survive a dropped connection, a dead battery, or a different
 * iPad — and what keeps the SSNs from existing only in a browser: the server
 * encrypts them apart from the rest and never sends them back. On a device
 * with nothing useful saved, the agent's most recent open draft is offered
 * back on load, minus those SSNs, which are merged in server-side at submit.
 * Scope section 4.3; lib/drafts.ts.
 */

const KEY = "im-agent-draft-v1";
/**
 * Who the local draft belongs to. Sign-out clears the draft, but a session can
 * also end without it — an expired cookie, a closed app, a different agent
 * signing in on the same tab. A draft whose owner is not the signed-in agent
 * is discarded unread rather than shown. Belt to sign-out's braces.
 */
const OWNER_KEY = "im-agent-draft-owner";
const MIRROR_DEBOUNCE_MS = 1500;

/**
 * Has anything worth keeping been typed? Gates both the mirror (so every
 * page view does not write an empty row) and resume (so an untouched local
 * draft does not block a real one from the server).
 */
function hasWork(d: CaptureDraft): boolean {
  return Boolean(
    d.zip ||
      d.selectedPlan ||
      d.householdIncome !== null ||
      d.people.some((p) => p.firstName || p.lastName || p.dateOfBirth),
  );
}

/**
 * Merge defaults at BOTH levels. Spreading only at the draft level left people
 * objects exactly as they were saved, so a field added to Person after a draft
 * was stored came back undefined — `ssnConfirm` did exactly that. Every future
 * field has the same problem, so the fix lives here, and applies to a draft
 * from sessionStorage and one from the server alike.
 */
function withDefaults(saved: CaptureDraft): CaptureDraft {
  const base = emptyDraft();
  return {
    ...base,
    ...saved,
    people: (saved.people ?? []).map((person) => ({
      ...emptyPerson(person.relation ?? "primary"),
      ...person,
      // Keep the saved key so React identity and the SSN inputs survive.
      key: person.key ?? crypto.randomUUID(),
    })),
  };
}

export function emptyPerson(relation: Person["relation"]): Person {
  return {
    key: crypto.randomUUID(),
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
    /* crypto.randomUUID, not Math.random. The draft id becomes the submission
     * key, which is hashed into the Jot's unique Form ID — so two drafts
     * sharing an id would produce the same Form ID, and the second submission
     * would be resolved as a "replay" of the first and silently return the
     * wrong client's record. 51 bits from a non-cryptographic PRNG is not the
     * place to economise on that. */
    id: crypto.randomUUID(),
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
    unemployment: "",
    parentCaretaker: "",
    preferredLanguage: "",
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
    photoId: null,
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
  /**
   * People whose SSN is held on the server for this draft and NOT in the
   * browser — a resumed draft. The stepper treats a held SSN as satisfied,
   * the review says "on file", and the submit route merges the number in.
   */
  heldSsnKeys: string[];
  /** The signed-in agent, for anything client-side that must be scoped to them. */
  agentId: string;
}

const DraftCtx = createContext<Ctx | null>(null);

export function DraftProvider({
  agentId,
  children,
}: {
  /** The signed-in agent. The local draft is bound to this id. */
  agentId: string;
  children: React.ReactNode;
}) {
  const [draft, setDraft] = useState<CaptureDraft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [heldSsnKeys, setHeldSsnKeys] = useState<string[]>([]);

  /* Rehydrate after mount, not during render — the server has no
   * sessionStorage and a mismatch would hydrate-error. Then, if this device
   * holds nothing useful, ask the server for the agent's latest open draft. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let local: CaptureDraft | null = null;
      try {
        const owner = sessionStorage.getItem(OWNER_KEY);
        if (owner !== agentId) {
          /* Another agent's, or from before ownership was recorded. Either
             way it is not this agent's to see. Removed, not merely ignored. */
          sessionStorage.removeItem(KEY);
          sessionStorage.removeItem("im-agent-capture-ui-v1");
        } else {
          const raw = sessionStorage.getItem(KEY);
          if (raw) local = withDefaults(JSON.parse(raw) as CaptureDraft);
        }
      } catch {
        /* corrupt or unavailable storage: start clean rather than fail */
      }

      if (local && hasWork(local)) {
        if (!cancelled) setDraft(local);
      } else {
        try {
          const res = await fetch("/api/drafts?latest=1", { cache: "no-store" });
          const data = res.ok
            ? ((await res.json()) as { draft: CaptureDraft | null; heldSsnKeys?: string[] })
            : { draft: null };
          if (cancelled) return;
          if (data.draft) {
            setDraft(withDefaults(data.draft));
            setHeldSsnKeys(data.heldSsnKeys ?? []);
          } else if (local) {
            setDraft(local);
          }
        } catch {
          /* offline or no database: the local copy, or a fresh one, is fine */
          if (!cancelled && local) setDraft(local);
        }
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(OWNER_KEY, agentId);
      sessionStorage.setItem(KEY, JSON.stringify(draft));
    } catch {
      /* private mode or full quota: the draft still works in memory */
    }
  }, [draft, loaded, agentId]);

  /* The mirror. Debounced so a burst of keystrokes is one write; skipped while
   * nothing has been captured; silent on failure because the browser copy is
   * still the working one and the next change retries. The response says
   * which people now have an SSN held, which is all the browser learns. */
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || !hasWork(draft)) return;
    if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    const snapshot = draft;
    mirrorTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/drafts/${snapshot.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: snapshot }),
        });
        if (res.ok && res.status !== 204) {
          const data = (await res.json()) as { heldSsnKeys?: string[] };
          if (data.heldSsnKeys) setHeldSsnKeys(data.heldSsnKeys);
        }
      } catch {
        /* offline: sessionStorage has it; the next change retries */
      }
    }, MIRROR_DEBOUNCE_MS);
    return () => {
      if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
    };
  }, [draft, loaded]);

  /* The current id, for reset — which is a stable callback and must not close
   * over a stale draft. */
  const idRef = useRef(draft.id);
  useEffect(() => {
    idRef.current = draft.id;
  }, [draft.id]);

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
    /* Discard the server copy too, so a draft the agent threw away does not
     * sit in the database holding SSNs for the rest of the retention window.
     * Fire-and-forget: the server only deletes OPEN drafts, so calling this
     * after a successful submit leaves the filed record alone. */
    const discarded = idRef.current;
    void fetch(`/api/drafts/${discarded}`, { method: "DELETE" }).catch(() => {});
    setHeldSsnKeys([]);
    const fresh = emptyDraft();
    setDraft(fresh);
    try {
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem(OWNER_KEY);
    } catch {
      /* nothing to clear */
    }
  }, []);

  return (
    <DraftCtx.Provider
      value={{
        draft,
        patch,
        patchPerson,
        addPerson,
        removePerson,
        reset,
        loaded,
        heldSsnKeys,
        agentId,
      }}
    >
      {children}
    </DraftCtx.Provider>
  );
}

export function useDraft(): Ctx {
  const ctx = useContext(DraftCtx);
  if (!ctx) throw new Error("useDraft must be used inside a DraftProvider.");
  return ctx;
}

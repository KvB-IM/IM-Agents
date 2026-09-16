import { ssnDigits, ssnConfirmed } from "./ssn.ts";
import type { CaptureDraft } from "./types.ts";

/**
 * Splitting SSNs out of a draft for storage, and merging them back at submit.
 *
 * Pure, like ssn.ts and redact.ts, because a bug here either stores a full SSN
 * in the wrong column or drops one silently — both invisible at write time and
 * both exactly what a unit test is for.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 * The server-side draft keeps SSNs in `ssn_cipher`, encrypted, APART from the
 * jsonb payload, and never returns them to a browser (scope 7.2: write-only
 * from the field). So a resumed draft arrives with blank SSN fields and a list
 * of which people have one "held". At submit the server merges the held values
 * back in before validation. A typed value always wins over a held one; an
 * attestation of "never issued" is never overridden.
 */

/** person.key → nine digits. */
export type HeldSsns = Record<string, string>;

/**
 * Take complete SSNs out of a draft.
 *
 * Only a CONFIRMED number is held — nine digits, structurally valid, and
 * matching its re-entry. Anything less is asked for again on resume. This
 * matters because merge fills BOTH fields from the held value: holding an
 * unconfirmed entry would turn a number typed once, possibly wrong, into one
 * that reads as confirmed after a resume — the exact typo the second box
 * exists to catch. The confirmation itself is never stored.
 */
export function splitSsns(draft: CaptureDraft): { payload: CaptureDraft; ssns: HeldSsns } {
  const ssns: HeldSsns = {};
  const people = draft.people.map((p) => {
    const digits = ssnDigits(p.ssn);
    if (!p.noSsn && ssnConfirmed(digits, p.ssnConfirm)) ssns[p.key] = digits;
    return { ...p, ssn: "", ssnConfirm: "" };
  });
  return { payload: { ...draft, people }, ssns };
}

/**
 * Fill BLANK SSNs from the held set. Anything typed is left alone, and so is
 * anyone attested as never issued one.
 */
export function mergeSsns(draft: CaptureDraft, held: HeldSsns): CaptureDraft {
  return {
    ...draft,
    people: draft.people.map((p) => {
      if (p.noSsn) return p;
      if (ssnDigits(p.ssn).length > 0) return p;
      const value = held[p.key];
      if (!value) return p;
      return { ...p, ssn: value, ssnConfirm: value };
    }),
  };
}

/** Which people have a held SSN — the only thing about them a browser is told. */
export function heldKeys(held: HeldSsns): string[] {
  return Object.keys(held).filter((k) => held[k]?.length === 9);
}

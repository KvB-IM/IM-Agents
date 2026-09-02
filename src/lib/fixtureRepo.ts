import "server-only";
import type { Jot } from "./types";
import type { AgentScope } from "./scope";
import { FIXTURE_JOTS } from "./fixtures";

/**
 * The fixture backend.
 *
 * Same signatures as jotsRepo, so store.ts can swap between them with no
 * caller changes. Used when no Zoho credentials are configured, which is what
 * lets the UI be built and demoed with nothing but `npm run dev`.
 *
 * State lives on globalThis because Next re-evaluates route modules in dev — a
 * module-level array resets between navigations, and a form submitted on
 * /capture had vanished by the time /pipeline rendered. It does not survive a
 * server restart, and it is per-process, which is exactly why it is fixtures
 * and not a data layer.
 */

interface FixtureState {
  jots: Jot[];
  counter: number;
}

const g = globalThis as unknown as { __imFixtureJots?: FixtureState };
g.__imFixtureJots ??= { jots: [...FIXTURE_JOTS], counter: 25000 };
const state = g.__imFixtureJots;

export async function listJots(scope: AgentScope): Promise<Jot[]> {
  return state.jots
    .filter((j) => scope.owns(j))
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

export async function getJot(scope: AgentScope, id: string): Promise<Jot | null> {
  const found = state.jots.find((j) => j.id === id);
  if (!found) return null;
  // An id is guessable, so ownership is checked on the single read too, not
  // only on the list. Mirrors what the COQL WHERE clause does in jotsRepo.
  if (!scope.owns(found)) return null;
  return found;
}

/**
 * Create a Jot from the same allowlisted payload the real backend receives.
 *
 * The payload is read rather than ignored, so the fixture path exercises the
 * mapping in draftToJot instead of quietly diverging from it — a field missing
 * from the allowlist shows up as a blank here too.
 */
export async function createJot(
  scope: AgentScope,
  record: Record<string, unknown>,
): Promise<Jot> {
  const str = (k: string): string => {
    const v = record[k];
    return typeof v === "string" ? v : v == null ? "" : String(v);
  };
  const numeric = (k: string): number | null => {
    const v = record[k];
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Mirror the real backend's uniqueness behaviour, so the fixture path
  // exercises the same replay handling rather than quietly allowing duplicates.
  const formId = str("Name");
  const dupe = state.jots.find((j) => j.formId === formId && scope.owns(j));
  if (dupe) return dupe;

  const n = ++state.counter;
  const jot: Jot = {
    // Synthetic prefix, deliberately not the org's real one.
    id: `900000000000${500000 + n}`,
    formId: formId || `AP-FIXTURE-${n}`,
    clientName:
      [str("First_Name"), str("Last_Name")].filter(Boolean).join(" ") || "(no name)",
    // A new form arrives with NO status, NO stage and NO classification.
    // Verified against production: a record created through the API came back
    // with Jot_Status, Enrollment_Stage and Classification all null — the
    // office's automation does not stamp them on create. The fixture said
    // "Awaiting Validation" here, which was an invention; matching reality
    // matters because the UI has to read correctly on a form that has just
    // been filed, which is exactly when an agent looks at it.
    status: "",
    enrollmentStage: "",
    classification: "",
    requirementStage: "",
    requirementDue: "",
    problems: [],
    requiredDocuments: [],
    // Mirrors the payload rather than "now", since the real create sends it.
    submittedAt: str("Submission_Time") || new Date().toISOString(),
    requestedEffective: str("Requested_Effective_Date"),
    premium: numeric("Premium"),
    // Net premium is not a CRM field; it exists only at quote time. Left null
    // so the fixture path and the real path agree about what is readable back.
    netPremium: null,
    carrier: str("Carrier1"),
    plan: str("Plan1"),
    metalLevel: "",
    householdSize: numeric("Household_Size"),
    policyId: "",
    policyName: "",
    // Taken from the scope, not from the payload — the same value the server
    // stamped, so a record cannot be filed into someone else's pipeline even
    // if the payload were tampered with.
    submittingFieldAgent: scope.agentName,
  };

  state.jots.unshift(jot);
  return jot;
}

export async function applyCorrections(
  scope: AgentScope,
  id: string,
  written: Record<string, unknown>,
): Promise<Jot | null> {
  const jot = await getJot(scope, id);
  if (!jot) return null;
  if (Object.keys(written).length === 0) return jot;

  // The real backend PUTs these to Zoho. Here the interesting behaviour to
  // reproduce is the one the screen depends on: submitting corrections clears
  // what the office was waiting for and moves the form out of "needs you".
  jot.problems = [];
  jot.requiredDocuments = [];
  jot.requirementStage = "Corrections submitted";
  jot.requirementDue = "";
  return jot;
}

/** Subforms are not modelled in fixtures; nothing renders them yet. */
export async function getJotDependents(): Promise<Array<Record<string, unknown>>> {
  return [];
}

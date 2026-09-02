import "server-only";
import type { Jot } from "./types";
import type { AgentScope } from "./scope";
import { zohoConfigured } from "./zoho";
import * as zohoRepo from "./jotsRepo";
import * as fixtureRepo from "./fixtureRepo";

/**
 * Jot reads and writes — the seam between the app and the CRM.
 *
 * With Zoho credentials configured this delegates to jotsRepo (real COQL and
 * real writes). With none, it delegates to fixtureRepo, and the header shows a
 * "Fixture data" badge. That is the same convention both existing apps use
 * (`ALLOW_MOCK_DATA` in IM_CRM_Frontend, `HS_ENROLLMENT_MOCK` in IM-Website),
 * and it is what lets this be demoed on an iPad with no credentials and no
 * signal.
 *
 * Every function takes an AgentScope. There is no way to read a Jot without
 * one, in either backend.
 */

/**
 * Which backend is live, for the header badge and the health check.
 *
 * Async because the refresh token may be stored in the database rather than
 * the environment — being "connected" is no longer answerable from env vars
 * alone.
 */
export async function usingLiveCrm(): Promise<boolean> {
  return zohoConfigured();
}

async function repo() {
  return (await zohoConfigured()) ? zohoRepo : fixtureRepo;
}

export async function listJots(scope: AgentScope): Promise<Jot[]> {
  return (await repo()).listJots(scope);
}

export async function getJot(scope: AgentScope, id: string): Promise<Jot | null> {
  return (await repo()).getJot(scope, id);
}

/**
 * Create a Jot from an already-allowlisted, already-attributed payload.
 *
 * Idempotency does not live here any more. The payload's `Name` (Form ID) is
 * derived deterministically from the agent and their submission key, and `Name`
 * is unique on the JOTS module — so a replayed submit is refused by Zoho as
 * DUPLICATE_DATA and resolved back to the record already filed. That holds
 * across processes and deploys, which the in-memory key map it replaced did
 * not. See formIdFor in lib/jot.ts.
 */
export async function createJot(
  scope: AgentScope,
  record: Record<string, unknown>,
): Promise<Jot> {
  return (await repo()).createJot(scope, record);
}

export async function applyCorrections(
  scope: AgentScope,
  id: string,
  written: Record<string, unknown>,
): Promise<Jot | null> {
  return (await repo()).applyCorrections(scope, id, written);
}

/* ── The correction allowlist ───────────────────────────────────────────────
 * Kept here rather than in either backend: it is a policy about what a field
 * agent may change, not a detail of how the change is stored. */

/** A field an agent may correct, as the browser needs to render it. */
export interface CorrectionField {
  key: string;
  api: string;
  label: string;
  type: "text" | "date" | "ssn" | "phone" | "email" | "integer" | "number";
}

/**
 * The correction form, served rather than duplicated in the frontend.
 *
 * Labels and types have to agree with the write allowlist exactly or a save
 * fails validation, and a second copy is a second thing to forget. Zoho api
 * names stay on the server — the browser never needs to know them.
 *
 * Grouped so a correction is found where it sat on the application rather than
 * in one long list.
 */
export const CORRECTION_GROUPS: Array<{ title: string; fields: CorrectionField[] }> = [
  {
    title: "Applicant",
    fields: [
      { key: "firstName", api: "First_Name", label: "First name", type: "text" },
      { key: "lastName", api: "Last_Name", label: "Last name", type: "text" },
      { key: "dateOfBirth", api: "DoB", label: "Date of birth", type: "date" },
      { key: "ssn", api: "SSN", label: "SSN", type: "ssn" },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "phone", api: "Phone", label: "Mobile", type: "phone" },
      { key: "homePhone", api: "Home_Phone", label: "Home phone", type: "phone" },
      { key: "email", api: "Email", label: "Email", type: "email" },
    ],
  },
  {
    title: "Home address",
    fields: [
      { key: "street", api: "Home_Street", label: "Street", type: "text" },
      { key: "city", api: "Home_City", label: "City", type: "text" },
      { key: "state", api: "Home_State", label: "State", type: "text" },
      { key: "zip", api: "Home_Zip", label: "ZIP", type: "text" },
    ],
  },
  {
    title: "Household and income",
    fields: [
      { key: "householdSize", api: "Household_Size", label: "Household size", type: "integer" },
      { key: "householdIncome", api: "Household_Income", label: "Household income", type: "number" },
      { key: "employmentIncome", api: "Employment_Income", label: "Employment income", type: "number" },
      { key: "employer", api: "Employer", label: "Employer", type: "text" },
    ],
  },
];

const CORRECTION_BY_KEY = new Map(
  CORRECTION_GROUPS.flatMap((g) => g.fields).map((f) => [f.key, f]),
);

/**
 * Reduce a client patch to the fields an agent may actually write.
 *
 * The safety boundary: a key absent from CORRECTION_GROUPS is dropped, whatever
 * the browser sends. Note what is NOT correctable from the field —
 * `Enrollment_Stage`, `Enrollment_Date`, `FFM_Application_ID`,
 * `FFM_Subscriber_ID`, `Problems`, `Classification`. Those are the office's own
 * record of what happened, and an agent overwriting the stage would corrupt
 * every KPI that counts it.
 *
 * A blank means "no change", never "clear this value". An agent who leaves a
 * box empty has not asked for the CRM's copy to be deleted.
 */
export function allowedCorrections(patch: Record<string, unknown>): Record<string, unknown> {
  const written: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const field = CORRECTION_BY_KEY.get(key);
    if (!field) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;

    // Numerics have to arrive as numbers; Zoho rejects "52000" on a currency
    // field with a type error that names the field but not the reason.
    if (field.type === "integer" || field.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      written[field.api] = field.type === "integer" ? Math.round(n) : n;
      continue;
    }
    written[field.api] = typeof value === "string" ? value.trim() : value;
  }
  return written;
}

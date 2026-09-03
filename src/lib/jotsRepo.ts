import "server-only";
import type { Jot } from "./types";
import type { AgentScope } from "./scope";
import {
  coql, coqlLiteral, createRecord, updateRecord, getRecord, assertRecordId,
  DuplicateRecordError,
} from "./zoho";
import { JOT_MODULE } from "./jot";

/**
 * JOTS reads and writes against the real CRM.
 *
 * Every read here takes an AgentScope and puts its criteria into the query.
 * There is no function in this file that can read a Jot without one — that is
 * SOFTWARE_SCOPE.md §7.1 expressed as a signature rather than a rule someone
 * has to remember, because with one service connection Zoho will happily return
 * the whole book of business.
 *
 * The field list and the lookup dot-notation below were verified against the
 * live module by COQL before being written down.
 */

/**
 * Columns read for the agent's submissions list.
 *
 * Deliberately narrow. This is the field app: it shows an agent where their own
 * forms stand, and it has no reason to pull the applicant's SSN, income detail
 * or dependents back out of the CRM. Widen only for something a screen renders.
 *
 * `Jot_Dependents` is absent on purpose — subforms do not come back through
 * COQL at all (see getRecord in zoho.ts), and nothing here needs them.
 */
const PIPELINE_COLUMNS = [
  "id",
  "Name",
  "Jot_Status",
  "Enrollment_Stage",
  "Classification",
  "Requirement_Stage",
  "Requirement_Due_Date",
  "Required_Documents",
  "Problems",
  "Submission_Time",
  "Modified_Time",
  "Client_Name",
  "First_Name",
  "Last_Name",
  "Requested_Effective_Date",
  "Premium",
  "Policy_Year",
  "Carrier1",
  "Plan1",
  "Household_Size",
  "Submitting_Field_Agent",
  // Dot-notation on the lookup, so the converted policy arrives in the same
  // round trip rather than needing a second query per row.
  "Policy.id",
  "Policy.Deal_Name",
].join(", ");

/** One COQL row, as Zoho actually returns it. */
interface JotRow {
  id?: string;
  Name?: string | null;
  Jot_Status?: string | null;
  Enrollment_Stage?: string | null;
  Classification?: string | null;
  Requirement_Stage?: string | null;
  Requirement_Due_Date?: string | null;
  Required_Documents?: string[] | null;
  Problems?: string[] | null;
  Submission_Time?: string | null;
  Modified_Time?: string | null;
  Client_Name?: string | null;
  First_Name?: string | null;
  Last_Name?: string | null;
  Requested_Effective_Date?: string | null;
  Premium?: number | string | null;
  Policy_Year?: string | null;
  Carrier1?: string | null;
  Plan1?: string | null;
  Household_Size?: number | string | null;
  Submitting_Field_Agent?: string | null;
  "Policy.id"?: string | null;
  "Policy.Deal_Name"?: string | null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Zoho sends empty numerics as null or "", and Number("") is 0 — which would
 *  render a real zero for a blank household size. Guard before coercing. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** A multi-select arrives as an array, or as null when unset. */
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => text(x)).filter(Boolean) : [];

function normalize(row: JotRow): Jot {
  const premium = num(row.Premium);

  return {
    id: text(row.id),
    // Zoho labels `Name` as "Form ID".
    formId: text(row.Name) || "(no form id)",
    // Client_Name is populated more reliably than First/Last on older forms.
    clientName:
      text(row.Client_Name) ||
      [text(row.First_Name), text(row.Last_Name)].filter(Boolean).join(" ") ||
      "(no name)",
    status: text(row.Jot_Status),
    enrollmentStage: text(row.Enrollment_Stage),
    classification: text(row.Classification),
    requirementStage: text(row.Requirement_Stage),
    requirementDue: text(row.Requirement_Due_Date),
    problems: list(row.Problems),
    requiredDocuments: list(row.Required_Documents),
    // Older forms exist with no Submission_Time; fall back to Modified_Time so
    // sorting and the age badge do not treat them as epoch zero.
    submittedAt: text(row.Submission_Time) || text(row.Modified_Time),
    requestedEffective: text(row.Requested_Effective_Date),
    premium,
    // The CRM stores gross premium only. Net is a function of the APTC at quote
    // time, which is not on the Jot, so it is null on anything read back —
    // never computed here, because a wrong net premium shown to an agent is
    // worse than none.
    netPremium: null,
    carrier: text(row.Carrier1),
    plan: text(row.Plan1),
    // Not on the Jot. Present in the type because a freshly submitted form
    // carries it through from the quote.
    metalLevel: "",
    householdSize: num(row.Household_Size),
    policyId: text(row["Policy.id"]),
    policyName: text(row["Policy.Deal_Name"]),
    submittingFieldAgent: text(row.Submitting_Field_Agent),
  };
}

/**
 * Every Jot belonging to this agent, newest first.
 *
 * Ordered by Submission_Time in the query rather than in JS: unlike the Get
 * Records API — which accepts only id, Created_Time and Modified_Time in
 * sort_by — COQL will order on any sortable field, and Submission_Time is
 * flagged sortable in the field metadata. That means the ordering is exact
 * across the whole result and not merely within a page.
 */
export async function listJots(scope: AgentScope, limit = 200): Promise<Jot[]> {
  const query =
    `select ${PIPELINE_COLUMNS} from ${JOT_MODULE} ` +
    `where Submitting_Field_Agent = ${coqlLiteral(scope.agentName)} ` +
    `order by Submission_Time desc limit ${Math.min(Math.max(1, limit), 200)}`;

  const page = await coql<JotRow>(query);
  return page.rows.map(normalize);
}

/**
 * One Jot, or null — including when it exists but belongs to another agent.
 *
 * The scope criteria is in the WHERE clause rather than checked after the fetch,
 * so another agent's record is never read into this process at all.
 */
export async function getJot(scope: AgentScope, id: string): Promise<Jot | null> {
  const safeId = assertRecordId(id);
  const query =
    `select ${PIPELINE_COLUMNS} from ${JOT_MODULE} ` +
    `where (id = ${safeId} and Submitting_Field_Agent = ${coqlLiteral(scope.agentName)}) ` +
    `limit 1`;

  const page = await coql<JotRow>(query);
  const row = page.rows[0];
  if (!row) return null;

  const jot = normalize(row);
  // Belt and braces. The query already filtered, but this is the one invariant
  // that must never fail, so it is asserted on the way out as well.
  if (!scope.owns(jot)) return null;
  return jot;
}

/**
 * Create a Jot.
 *
 * `record` is the allowlisted payload from draftToJot, with attribution already
 * stamped server-side. This function does not add or override fields — if
 * something is missing, fix it in draftToJot where the allowlist lives.
 *
 * Returns the created form as Submissions will show it, read back rather than
 * assumed: Zoho applies workflows on create, and the stage or status the office
 * automation sets is the truth, not whatever this app hoped for.
 */
export async function createJot(
  scope: AgentScope,
  record: Record<string, unknown>,
): Promise<Jot> {
  let id: string;
  try {
    ({ id } = await createRecord(JOT_MODULE, record));
  } catch (err) {
    if (err instanceof DuplicateRecordError) {
      // The Form ID already exists, so this submission was already filed —
      // a replay after a dropped response, not a failure. Resolve it to the
      // record that is already there. This is the durable half of idempotency:
      // it holds across processes and deploys, which the in-memory key map
      // never did.
      const existing = await findByFormId(scope, String(record.Name ?? ""));
      if (existing) return existing;
    }
    throw err;
  }

  const created = await getJot(scope, id);
  if (created) return created;

  // Created but not readable back under this agent's scope. That means the
  // attribution did not stick — almost certainly the agent's name is not on
  // Zoho's `Agent` global picklist, which silently drops the value. Loud,
  // because the form now exists with no field agent on it.
  throw new Error(
    `Created ${JOT_MODULE}/${id} but could not read it back as "${scope.agentName}". ` +
      `Check that this agent exists in Zoho's Agent global picklist — ` +
      `Submitting_Field_Agent silently drops values that are not on it.`,
  );
}

/**
 * Find one of this agent's Jots by its Form ID (`Name`).
 *
 * Scoped like every other read, so a replay cannot be used to fish another
 * agent's record out by guessing form ids.
 */
export async function findByFormId(scope: AgentScope, formId: string): Promise<Jot | null> {
  if (!formId) return null;
  const query =
    `select ${PIPELINE_COLUMNS} from ${JOT_MODULE} ` +
    `where (Name = ${coqlLiteral(formId)} ` +
    `and Submitting_Field_Agent = ${coqlLiteral(scope.agentName)}) limit 1`;

  const page = await coql<JotRow>(query);
  const row = page.rows[0];
  return row ? normalize(row) : null;
}

/**
 * Apply an agent's corrections.
 *
 * `patch` is already allowlisted by the caller. Ownership is re-established
 * here with a scoped read before anything is written, so a PATCH cannot touch
 * another agent's form even if the id is guessed.
 */
export async function applyCorrections(
  scope: AgentScope,
  id: string,
  written: Record<string, unknown>,
): Promise<Jot | null> {
  const existing = await getJot(scope, id);
  if (!existing) return null;
  if (Object.keys(written).length === 0) return existing;

  await updateRecord(JOT_MODULE, id, written);
  return getJot(scope, id);
}

/**
 * The dependents subform for one Jot.
 *
 * Separate from the submissions read because subform rows come back only on a
 * single-record GET. Ownership is checked first — `getRecord` is unscoped, so
 * calling it without this guard would read any Jot in the org.
 */
export async function getJotDependents(
  scope: AgentScope,
  id: string,
): Promise<Array<Record<string, unknown>>> {
  const owned = await getJot(scope, id);
  if (!owned) return [];

  const record = await getRecord<{ Jot_Dependents?: Array<Record<string, unknown>> }>(
    JOT_MODULE,
    id,
    ["Jot_Dependents"],
  );
  return record?.Jot_Dependents ?? [];
}

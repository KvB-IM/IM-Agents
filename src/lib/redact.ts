/**
 * Removing secrets from a payload before it is stored a second time.
 *
 * Pure and import-free, like coql.ts, password.ts, ssn.ts and safeNext.ts, so
 * it can be unit-tested directly. That is not incidental: a bug here writes
 * full SSNs into a second system silently, with no error and no symptom, so it
 * is exactly the kind of code that has to be testable without a database.
 */

/** Last four digits, or "" when there are not enough to be useful. */
function last4(v: unknown): string {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

/**
 * Strip SSNs from a Zoho JOTS payload, keeping only the last four digits.
 *
 * Handles the parent record and every `Jot_Dependents` row. Last four rather
 * than nothing at all because reconciling a rejected submission means matching
 * it to a person, and "…9031" does that without holding a second complete copy
 * of every applicant's and dependent's number. `IM-Website`'s buffer keeps last
 * four for the same reason.
 *
 * Anything malformed is passed through untouched rather than throwing: this
 * runs on the submission path, and the buffer must never be the reason a
 * finished application fails to file.
 */
export function redactSsns(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (key === "SSN") {
      const tail = last4(value);
      if (tail) out.SSN_last4 = tail;
      continue;
    }

    if (key === "Jot_Dependents" && Array.isArray(value)) {
      out.Jot_Dependents = value.map((row) => {
        if (!row || typeof row !== "object") return row;
        const copy: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          if (k === "SSN") {
            const tail = last4(v);
            if (tail) copy.SSN_last4 = tail;
            continue;
          }
          copy[k] = v;
        }
        return copy;
      });
      continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Coerce a value for the buffer's typed `date` column.
 *
 * Returns null for anything Postgres would refuse.
 *
 * This exists because of a real failure: the buffer's `requested_effective` is
 * a `date`, and a submission carrying "2026-13-45" — which is exactly the kind
 * of malformed value the CRM rejects — ALSO broke the buffer insert. So the
 * safety net failed in the one scenario it was built for, and the application
 * would have been lost with no record.
 *
 * The raw value is never lost: it stays in the `payload` jsonb, which has no
 * type to violate. The typed column is only there to make reconciliation
 * queries readable, so nulling it costs nothing.
 *
 * The general lesson, worth keeping in mind for any column added to
 * jot_submissions: a buffer whose own schema can reject the data it is meant to
 * preserve is not a buffer.
 */
export function bufferDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Catches 2026-02-30, which passes the range checks above.
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    return null;
  }
  return value;
}

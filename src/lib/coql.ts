/**
 * Query-safety helpers for COQL.
 *
 * Deliberately free of `server-only` and of every other import: this is pure
 * logic, it is the entire boundary between an agent name and an injected WHERE
 * clause, and it needs to be directly testable. `zoho.ts` re-exports it.
 */

export class QueryValueError extends Error {
  /* Fields are declared and assigned explicitly rather than via constructor
     parameter properties: this module is unit-tested under Node's type
     stripping, which cannot transform those (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX)
     — it only removes annotations. Keeping this file strip-compatible is what
     lets the injection guard be tested without a build step. */
  status: number;
  userMessage: string;

  constructor(status: number, userMessage: string, detail?: string) {
    super(detail ?? userMessage);
    this.name = "QueryValueError";
    this.status = status;
    this.userMessage = userMessage;
  }
}

/** Characters permitted in a value this app filters on. */
const SAFE_LITERAL = /^[A-Za-z0-9 .,\-_&/']+$/;

/**
 * Turn a value into a COQL string literal.
 *
 * COQL delimits strings with single quotes and documents no escape sequence, so
 * a value containing one cannot be interpolated safely — it is rejected rather
 * than mangled. The permitted set is deliberately narrow: the only values this
 * app filters on are `Agent` global-picklist entries, and none legitimately
 * contains anything outside it.
 *
 * An apostrophe passes the charset test and is then refused separately, so the
 * error can say which problem it was. Names like "O'Brien" are plausible, and
 * that failure needs to read as a known limitation rather than as corruption.
 */
export function coqlLiteral(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) {
    throw new QueryValueError(400, "Invalid query value.", "coql literal empty or too long");
  }
  if (!SAFE_LITERAL.test(value)) {
    throw new QueryValueError(
      400,
      "Invalid query value.",
      "coql literal has disallowed characters",
    );
  }
  if (value.includes("'")) {
    throw new QueryValueError(
      500,
      "This agent name cannot be used to query the CRM because it contains an apostrophe. Zoho's query language has no way to escape one.",
      "coql literal contains an apostrophe",
    );
  }
  return `'${value}'`;
}

/**
 * A Zoho record id. Validated because it lands in a URL path and, for the
 * scoped single read, inside a COQL clause.
 */
export function assertRecordId(id: string): string {
  if (typeof id !== "string" || !/^\d{15,20}$/.test(id)) {
    throw new QueryValueError(400, "Invalid record id.");
  }
  return id;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { coqlLiteral, assertRecordId, QueryValueError } from "../src/lib/coql.ts";

/*
 * COQL has no parameter binding, so the only thing standing between an agent
 * name and an injected query clause is coqlLiteral. These tests exist because
 * that function is the whole boundary — which is also why it lives in its own
 * import-free module rather than inside the server-only Zoho client.
 */

test("coqlLiteral quotes an ordinary agent name", () => {
  assert.equal(coqlLiteral("Dana Ruiz"), "'Dana Ruiz'");
  assert.equal(coqlLiteral("Avery Lindqvist"), "'Avery Lindqvist'");
});

test("coqlLiteral allows the punctuation real agency names carry", () => {
  assert.equal(coqlLiteral("Southern Health & Retirement"), "'Southern Health & Retirement'");
  assert.equal(coqlLiteral("Jones, Cindy"), "'Jones, Cindy'");
  assert.equal(coqlLiteral("Smith-Boyd"), "'Smith-Boyd'");
});

test("coqlLiteral refuses a value that would close the string and widen the clause", () => {
  // The attack this guard exists for: escaping the literal to read every
  // agent's forms rather than the caller's own.
  assert.throws(
    () => coqlLiteral("x' or Submitting_Field_Agent != 'zzz"),
    (err) => err instanceof QueryValueError,
  );
});

test("coqlLiteral gives an apostrophe its own legible error", () => {
  // A plausible name, not an attack. COQL documents no escape sequence, so it
  // genuinely cannot be queried — the failure has to say so rather than look
  // like data corruption.
  assert.throws(
    () => coqlLiteral("Shaun O'Brien"),
    (err) => err instanceof QueryValueError && /apostrophe/i.test(err.userMessage),
  );
});

test("coqlLiteral refuses quotes, control characters and clause punctuation", () => {
  for (const bad of ['a"b', "a\nb", "a\tb", "a\\b", "a;b", "a(b)", "a=b", "a<b"]) {
    assert.throws(
      () => coqlLiteral(bad),
      (err) => err instanceof QueryValueError,
      `allowed ${JSON.stringify(bad)}`,
    );
  }
});

test("coqlLiteral refuses empty and over-long values", () => {
  assert.throws(() => coqlLiteral(""), (err) => err instanceof QueryValueError);
  assert.throws(() => coqlLiteral("a".repeat(201)), (err) => err instanceof QueryValueError);
});

test("assertRecordId accepts a real Zoho id and refuses anything else", () => {
  assert.equal(assertRecordId("9000000000000000123"), "9000000000000000123");
  // Path traversal and clause injection, since the id lands in a URL path and
  // in the scoped single-read WHERE clause.
  for (const bad of ["../Contacts", "1 or 1=1", "9000000000000000123'", "", "12345", "abc"]) {
    assert.throws(
      () => assertRecordId(bad),
      (err) => err instanceof QueryValueError,
      `allowed ${JSON.stringify(bad)}`,
    );
  }
});

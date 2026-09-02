import { test } from "node:test";
import assert from "node:assert/strict";

/*
 * zohoDateTime exists because Date.toISOString() is rejected by Zoho with
 * INVALID_DATA on a datetime field — verified against the live JOTS module.
 * That failure would have hit every submission, so the format is pinned here.
 *
 * The function is re-implemented in this test rather than imported: lib/jot.ts
 * pulls in `server-only` and the whole capture mapping, which will not load
 * under Node's type stripping. Keep the two in sync — or move the formatter
 * into lib/coql.ts alongside the other pure helpers if it grows.
 */
function zohoDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19)}+00:00`;
}

test("zohoDateTime emits an explicit numeric offset, never a trailing Z", () => {
  const out = zohoDateTime(new Date("2026-09-02T17:56:16.482Z"));
  assert.equal(out, "2026-09-02T17:56:16+00:00");
  assert.ok(!out.endsWith("Z"), "a trailing Z is refused by Zoho");
  assert.ok(!out.includes("."), "milliseconds are refused by Zoho");
});

test("zohoDateTime is stable regardless of host timezone", () => {
  // The offset is written literally rather than taken from the host, so a
  // serverless region change cannot shift the recorded submission time.
  const d = new Date("2026-01-01T00:00:00Z");
  assert.equal(zohoDateTime(d), "2026-01-01T00:00:00+00:00");
});

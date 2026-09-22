import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionCounts } from "../src/lib/submissionCounts.ts";

/* "Today" is a timezone question. The server is UTC; the office is Eastern.
 * Every case here is chosen to fail if the boundaries were taken from UTC. */

const TZ = "America/New_York";
// Wednesday 2026-09-16, 10:00 Eastern (14:00Z).
const NOW = new Date("2026-09-16T14:00:00Z");
const count = (times: string[], now = NOW) =>
  submissionCounts(times.map((t) => ({ submittedAt: t })), now, TZ);

test("a form filed at 9pm Eastern is today's, even though it is tomorrow in UTC", () => {
  // 2026-09-16T21:00-04:00 = 2026-09-17T01:00Z
  const c = count(["2026-09-16T21:00:00-04:00"]);
  assert.equal(c.today, 1);
  assert.equal(c.yesterday, 0);
});

test("a form filed at 11pm Eastern yesterday is yesterday's, not today's", () => {
  // 2026-09-15T23:30-04:00 = 2026-09-16T03:30Z — UTC would call this today.
  const c = count(["2026-09-15T23:30:00-04:00"]);
  assert.equal(c.today, 0);
  assert.equal(c.yesterday, 1);
  assert.equal(c.thisWeek, 1); // Tuesday of the same week
});

test("this week starts Monday in the office zone", () => {
  const c = count([
    "2026-09-14T09:00:00-04:00", // Monday        — in
    "2026-09-13T23:59:00-04:00", // Sunday night  — out
    "2026-09-16T08:00:00-04:00", // today         — in
  ]);
  assert.equal(c.thisWeek, 2);
  assert.equal(c.total, 3);
});

test("total counts everything, including a row whose time cannot be parsed", () => {
  const c = count(["garbage", "2026-01-01T12:00:00-05:00"]);
  assert.equal(c.total, 2);
  assert.equal(c.today + c.yesterday + c.thisWeek, 0);
});

test("on a Monday, this week is just today", () => {
  const monday = new Date("2026-09-14T15:00:00Z"); // Mon 11:00 Eastern
  const c = count(["2026-09-14T09:00:00-04:00", "2026-09-13T18:00:00-04:00"], monday);
  assert.equal(c.thisWeek, 1);
  assert.equal(c.yesterday, 1);
});

test("Zoho's own timestamp format is understood", () => {
  // As jotsRepo normalises Submission_Time: ISO with a numeric offset.
  const c = count(["2026-09-16T09:15:22-04:00"]);
  assert.equal(c.today, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readCaptureUi, serializeCaptureUi, closedAt } from "../src/lib/captureUi.ts";

const STEPS = 6;

test("nothing saved means closed, at the beginning", () => {
  assert.deepEqual(readCaptureUi(null, "d1", STEPS), { draftId: "d1", editing: false, step: 0 });
});

test("a saved position round-trips, which is the whole point", () => {
  const ui = { draftId: "d1", editing: true, step: 3 };
  assert.deepEqual(readCaptureUi(serializeCaptureUi(ui), "d1", STEPS), ui);
});

test("a position from another draft is ignored, not inherited", () => {
  const other = serializeCaptureUi({ draftId: "old", editing: true, step: 5 });
  assert.deepEqual(readCaptureUi(other, "new", STEPS), closedAt("new"));
});

test("corrupt storage falls back rather than throwing", () => {
  for (const raw of ["", "{", "null", "[]", '"a string"', "42"]) {
    assert.deepEqual(readCaptureUi(raw, "d1", STEPS), closedAt("d1"));
  }
});

test("a step index beyond this form's steps is clamped, not trusted", () => {
  const ahead = serializeCaptureUi({ draftId: "d1", editing: true, step: 99 });
  assert.equal(readCaptureUi(ahead, "d1", STEPS).step, STEPS - 1);
});

test("a negative or fractional step is coerced to a real index", () => {
  const back = JSON.stringify({ draftId: "d1", editing: true, step: -4 });
  assert.equal(readCaptureUi(back, "d1", STEPS).step, 0);
  const frac = JSON.stringify({ draftId: "d1", editing: true, step: 2.7 });
  assert.equal(readCaptureUi(frac, "d1", STEPS).step, 2);
});

test("editing is only true when it is literally true", () => {
  for (const v of ["yes", 1, null, undefined]) {
    const raw = JSON.stringify({ draftId: "d1", editing: v, step: 1 });
    assert.equal(readCaptureUi(raw, "d1", STEPS).editing, false);
  }
});

test("a missing step is treated as the beginning, keeping editing intact", () => {
  const raw = JSON.stringify({ draftId: "d1", editing: true });
  assert.deepEqual(readCaptureUi(raw, "d1", STEPS), { draftId: "d1", editing: true, step: 0 });
});

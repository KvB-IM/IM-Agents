import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ssnDigits,
  formatSsn,
  maskedSsn,
  ssnProblem,
  ssnConfirmed,
  applySsnInput,
} from "../src/lib/ssn.ts";

test("digits are extracted and capped at nine", () => {
  assert.equal(ssnDigits("412-88-9031"), "412889031");
  assert.equal(ssnDigits("412 88 9031"), "412889031");
  assert.equal(ssnDigits("4128890319999"), "412889031");
  assert.equal(ssnDigits(""), "");
});

test("the dashed form is what Zoho stores, and only when complete", () => {
  assert.equal(formatSsn("412889031"), "412-88-9031");
  // Incomplete returns empty, so the allowlist gate drops it rather than
  // writing a partial number to the CRM.
  assert.equal(formatSsn("41288"), "");
  assert.equal(formatSsn(""), "");
});

test("masking shows only the most recent digit", () => {
  // The last digit stays visible so a keystroke can be confirmed; entering
  // nine digits fully blind on a touch keyboard is how a transposition
  // survives to the carrier.
  assert.equal(maskedSsn("1"), "1");
  assert.equal(maskedSsn("12"), "•2");
  assert.equal(maskedSsn("123"), "••3");
  assert.equal(maskedSsn("1234"), "•••-4");
  assert.equal(maskedSsn("12345"), "•••-•5");
  assert.equal(maskedSsn("123456"), "•••-••-6");
  assert.equal(maskedSsn("123456789"), "•••-••-•••9");
  assert.equal(maskedSsn(""), "");
});

test("the real number never appears in the masked display", () => {
  const real = "412889031";
  const shown = maskedSsn(real);
  assert.ok(!shown.includes("412"), "area number leaked");
  assert.ok(!shown.includes("88"), "group number leaked");
  // Only the final digit is legible.
  assert.equal(shown.replace(/[•\-]/g, ""), "1");
});

test("structurally impossible numbers are refused", () => {
  // Combinations the Marketplace itself rejects, so an application is not
  // filed knowing it will bounce.
  assert.match(ssnProblem("000889031") ?? "", /area number/i);
  assert.match(ssnProblem("666889031") ?? "", /area number/i);
  assert.match(ssnProblem("900889031") ?? "", /area number/i);
  assert.match(ssnProblem("999889031") ?? "", /area number/i);
  assert.match(ssnProblem("412009031") ?? "", /middle two/i);
  assert.match(ssnProblem("412880000") ?? "", /last four/i);
});

test("a valid number passes", () => {
  assert.equal(ssnProblem("412889031"), null);
  assert.equal(ssnProblem("001010001"), null);
  assert.equal(ssnProblem("899889031"), null);
});

test("incomplete entry reports how many digits remain", () => {
  assert.match(ssnProblem("") ?? "", /required/i);
  assert.equal(ssnProblem("41288"), "4 more digits needed.");
  assert.equal(ssnProblem("41288903"), "1 more digit needed.");
});

test("confirmation requires a complete, valid, identical entry", () => {
  assert.ok(ssnConfirmed("412889031", "412889031"));
  assert.ok(ssnConfirmed("412-88-9031", "412889031"), "compares digits, not formatting");

  assert.equal(ssnConfirmed("412889031", "412889032"), false, "one digit different");
  assert.equal(ssnConfirmed("412889031", "412889"), false, "incomplete confirmation");
  assert.equal(ssnConfirmed("41288", "41288"), false, "both incomplete");
  assert.equal(ssnConfirmed("", ""), false, "both empty is not confirmed");
  // A transposition — the failure this whole mechanism exists to catch.
  assert.equal(ssnConfirmed("412889031", "412889013"), false, "transposed last two");
  // Invalid but matching must still fail: agreeing on a number the exchange
  // will reject is not confirmation.
  assert.equal(ssnConfirmed("000889031", "000889031"), false, "matching but invalid");
});

/*
 * Keystroke handling.
 *
 * These exist because the first implementation passed every formatter test and
 * was still completely broken: it capped the field at two digits. The input
 * shows the mask, so a change event has to be read as a delta against what was
 * rendered — not as a value.
 */
test("typing digit by digit accumulates the whole number", () => {
  let digits = "";
  const typed = [];
  for (const d of "412889031") {
    // The browser appends the keystroke to whatever is displayed — the mask.
    digits = applySsnInput(maskedSsn(digits) + d, digits);
    typed.push(maskedSsn(digits));
  }
  assert.equal(digits, "412889031");
  assert.deepEqual(typed, [
    "4",
    "•1",
    "••2",
    "•••-8",
    "•••-•8",
    "•••-••-9",
    "•••-••-•0",
    "•••-••-••3",
    "•••-••-•••1",
  ]);
});

test("backspace removes one digit", () => {
  const digits = "41288";
  // A backspace leaves the field one character shorter than the mask.
  const shorter = maskedSsn(digits).slice(0, -1);
  assert.equal(applySsnInput(shorter, digits), "4128");
  assert.equal(applySsnInput("", "4"), "");
});

test("a paste of a full number is taken wholesale", () => {
  assert.equal(applySsnInput("412-88-9031", ""), "412889031");
  assert.equal(applySsnInput("412889031", ""), "412889031");
  // Pasting over an existing entry replaces it.
  assert.equal(applySsnInput("999-88-7777", "412889031"), "999887777");
});

test("non-digits are ignored rather than accepted", () => {
  assert.equal(applySsnInput(maskedSsn("412") + "x", "412"), "412");
  assert.equal(applySsnInput(maskedSsn("412") + " ", "412"), "412");
});

test("an unchanged event is a no-op", () => {
  assert.equal(applySsnInput(maskedSsn("41288"), "41288"), "41288");
});

test("the tenth digit is refused", () => {
  assert.equal(applySsnInput(maskedSsn("412889031") + "5", "412889031"), "412889031");
});

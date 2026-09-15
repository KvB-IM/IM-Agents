import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFICE_PHONE_DISPLAY, OFFICE_PHONE_TEL, OFFICE_PHONE_HREF } from "../src/lib/office.ts";

/* The button shows one number and dials another only if these drift. They
 * are derived from one string, and this pins that. */

test("the dialed number is the displayed number, in E.164", () => {
  assert.equal(OFFICE_PHONE_DISPLAY, "(803) 761-0222");
  assert.equal(OFFICE_PHONE_TEL, "+18037610222");
  assert.equal(OFFICE_PHONE_TEL.replace(/^\+1/, ""), OFFICE_PHONE_DISPLAY.replace(/\D/g, ""));
});

test("the href is a tel: link, so it hands off to the dialer without navigating", () => {
  assert.equal(OFFICE_PHONE_HREF, "tel:+18037610222");
  assert.match(OFFICE_PHONE_HREF, /^tel:\+1\d{10}$/);
});

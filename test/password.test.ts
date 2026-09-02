import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  checkPasswordPolicy,
  DUMMY_HASH,
} from "../src/lib/password.ts";

test("a hashed password verifies, and a wrong one does not", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.ok(await verifyPassword("correct horse battery staple", hash));
  assert.equal(await verifyPassword("Correct horse battery staple", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("the same password hashes differently every time", async () => {
  // Per-hash random salt. The anti-requirement is the ICHRA system's unsalted
  // SHA-256, where identical passwords produced identical hashes and one
  // rainbow table did the whole table.
  const a = await hashPassword("same password twice");
  const b = await hashPassword("same password twice");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("same password twice", a));
  assert.ok(await verifyPassword("same password twice", b));
});

test("the stored format carries its own cost parameters", async () => {
  const hash = await hashPassword("parameters travel with the hash");
  const [algo, n, r, p] = hash.split("$");
  assert.equal(algo, "scrypt");
  assert.equal(Number(n), 32768);
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 1);
  // Which is what lets the cost be raised later without invalidating rows.
  assert.equal(hash.split("$").length, 6);
});

test("verify refuses a malformed or tampered stored value instead of throwing", async () => {
  for (const bad of [
    "",
    "notahash",
    "scrypt$32768$8$1$onlyfiveparts",
    "bcrypt$32768$8$1$c2FsdA$aGFzaA",
    "scrypt$$$$",
    "scrypt$32768$8$1$$",
  ]) {
    assert.equal(
      await verifyPassword("anything", bad),
      false,
      `should have refused ${JSON.stringify(bad)}`,
    );
  }
});

test("verify refuses absurd cost parameters rather than burning CPU on them", async () => {
  // A tampered row claiming a huge N would otherwise be a denial of service
  // against our own login endpoint.
  const hostile = "scrypt$1073741824$8$1$c2FsdHNhbHRzYWx0c2E$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYQ";
  const started = Date.now();
  assert.equal(await verifyPassword("anything", hostile), false);
  assert.ok(Date.now() - started < 1000, "refusal should be immediate, not computed");
});

test("the dummy hash verifies against nothing but is well-formed", async () => {
  // Used on the unknown-email path so login costs the same whether or not the
  // account exists. It has to be parseable, or the timing equalisation it
  // exists for would collapse to an instant false.
  assert.equal(DUMMY_HASH.split("$").length, 6);
  assert.equal(await verifyPassword("anything at all", DUMMY_HASH), false);
});

test("unknown-email and wrong-password paths take comparable time", async () => {
  const real = await hashPassword("a real agent password");

  const time = async (fn: () => Promise<unknown>) => {
    const t = Date.now();
    await fn();
    return Date.now() - t;
  };

  const wrongPassword = await time(() => verifyPassword("guess", real));
  const unknownEmail = await time(() => verifyPassword("guess", DUMMY_HASH));

  // Not asserting they are equal — scrypt timing varies and a strict bound
  // would make this test flaky. Asserting the dummy path does real work, which
  // is the property that matters: an instant return would leak which emails
  // exist.
  assert.ok(
    unknownEmail > wrongPassword / 4,
    `dummy path was ${unknownEmail}ms vs ${wrongPassword}ms — too fast to hide enumeration`,
  );
});

test("password policy leads on length, not composition theatre", () => {
  assert.equal(checkPasswordPolicy("a reasonable passphrase"), null);
  assert.ok(checkPasswordPolicy("short"));
  assert.ok(checkPasswordPolicy("aaaaaaaaaaaaaaa"));
  assert.ok(checkPasswordPolicy("password12345"));
  assert.ok(checkPasswordPolicy("x".repeat(201)));
  // Deliberately accepted: no upper/digit/symbol requirement. Composition
  // rules mostly produce Passw0rd! and a 23-character passphrase beats it.
  assert.equal(checkPasswordPolicy("all lower case words here"), null);
});

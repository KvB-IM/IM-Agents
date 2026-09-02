import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, _keyFrom } from "../src/lib/crypto.ts";

/*
 * AES-256-GCM round trip, for secrets the app must read back — the Zoho
 * refresh token and draft SSNs. A key is passed explicitly so these need no
 * environment.
 */
const KEY = _keyFrom("a".repeat(64));
const OTHER_KEY = _keyFrom("b".repeat(64));

test("a secret survives a round trip", () => {
  const secret = "1000.abcdef0123456789.fedcba9876543210";
  assert.equal(decryptSecret(encryptSecret(secret, KEY), KEY), secret);
});

test("the same plaintext encrypts differently every time", () => {
  // Random IV per encryption. Without it, two identical tokens would produce
  // identical ciphertext and the storage would leak equality.
  const a = encryptSecret("same secret", KEY);
  const b = encryptSecret("same secret", KEY);
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, KEY), "same secret");
  assert.equal(decryptSecret(b, KEY), "same secret");
});

test("the wrong key returns null rather than garbage", () => {
  // The realistic case: APP_ENCRYPTION_KEY was rotated. That has to degrade to
  // "reconnect Zoho", not to a crash or a plausible-looking wrong token.
  const payload = encryptSecret("a refresh token", KEY);
  assert.equal(decryptSecret(payload, OTHER_KEY), null);
});

test("tampered ciphertext is rejected, not silently accepted", () => {
  // What GCM's auth tag is for. A malleable ciphertext on a refresh token
  // would be a way to steer the app at a different credential.
  const payload = encryptSecret("a refresh token", KEY);
  const [v, iv, tag, ct] = payload.split(".");

  const flip = (s: string) => {
    const buf = Buffer.from(s, "base64url");
    buf[0] ^= 0xff;
    return buf.toString("base64url");
  };

  assert.equal(decryptSecret([v, iv, tag, flip(ct)].join("."), KEY), null, "ciphertext");
  assert.equal(decryptSecret([v, flip(iv), tag, ct].join("."), KEY), null, "iv");
  assert.equal(decryptSecret([v, iv, flip(tag), ct].join("."), KEY), null, "tag");
});

test("malformed payloads return null instead of throwing", () => {
  for (const bad of ["", "notapayload", "v1.a.b", "v2.a.b.c", "v1...", "v1.$.$.$"]) {
    assert.equal(decryptSecret(bad, KEY), null, `should have refused ${JSON.stringify(bad)}`);
  }
});

test("the payload is versioned, so the algorithm can change later", () => {
  assert.ok(encryptSecret("x", KEY).startsWith("v1."));
});

test("a 64-char hex key is used directly; anything else is hashed to 32 bytes", () => {
  assert.equal(_keyFrom("f".repeat(64)).length, 32);
  assert.deepEqual(_keyFrom("f".repeat(64)), Buffer.from("f".repeat(64), "hex"));
  // A non-hex value still yields a usable key rather than failing — but it only
  // carries as much entropy as the input, which is why the error text asks for
  // the hex form.
  assert.equal(_keyFrom("a short passphrase").length, 32);
});

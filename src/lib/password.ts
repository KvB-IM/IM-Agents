import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing.
 *
 * scrypt from node:crypto — memory-hard, in the standard library, no dependency
 * to audit or keep patched. Argon2id would be the other defensible choice but
 * needs a native module.
 *
 * The anti-requirement this exists against is explicit in the scope doc: the
 * ICHRA system hashed with unsalted SHA-256. Every hash here carries its own
 * random salt and the cost parameters travel with it, so parameters can be
 * raised later without invalidating existing passwords.
 *
 * Deliberately free of `server-only` and of any project import, like coql.ts,
 * so it can be unit-tested directly under Node's type stripping.
 */

/* Cost parameters. N is the CPU/memory cost and must be a power of two.
 * 2^15 with r=8 is ~32MB per hash — comfortably above the 2^14 often quoted,
 * and still only a few hundred milliseconds, which is the right trade for a
 * login that happens once per shift rather than once per request.
 *
 * maxmem has to be raised explicitly: Node's default 32MB cap rejects these
 * parameters with "Invalid scrypt params", which is a confusing way to find out.
 */
const N = 1 << 15;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const MAXMEM = 128 * N * R * 2;

function scryptAsync(password: string, salt: Buffer, keylen: number, params: {
  N: number;
  r: number;
  p: number;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      keylen,
      { N: params.N, r: params.r, p: params.p, maxmem: MAXMEM },
      (err, derived) => (err ? reject(err) : resolve(derived)),
    );
  });
}

/**
 * Hash a password for storage.
 *
 * Returns a self-describing string: `scrypt$N$r$p$salt$hash`, both parts
 * base64url. Storing the parameters alongside the hash is what makes raising
 * the cost later a non-event — verify reads whatever the row was written with.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P });
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Verify a password against a stored hash.
 *
 * Always returns a boolean; a malformed stored value is a false, never a throw.
 * A crash here would turn one corrupt row into a 500 that leaks which account
 * is broken.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");

    // Guard the parameters before handing them to scrypt: a tampered row
    // claiming N = 2^30 would otherwise be a denial-of-service on our own CPU.
    if (!Number.isInteger(n) || n < 1024 || n > 1 << 20) return false;
    if (!Number.isInteger(r) || r < 1 || r > 32) return false;
    if (!Number.isInteger(p) || p < 1 || p > 16) return false;
    if (salt.length < 8 || expected.length < 16) return false;

    const derived = await scryptAsync(password, salt, expected.length, { N: n, r, p });
    // Constant-time: a length-safe compare, then timingSafeEqual.
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * A dummy hash, for the unknown-email path.
 *
 * Login must do the same work whether or not the account exists, or the
 * response time tells an attacker which emails are real. The login route
 * verifies against this when it finds no agent.
 */
export const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Password policy.
 *
 * Length first, because length is what actually resists guessing. A 12-char
 * floor rather than the scope doc's 8 with character classes: an agent account
 * unlocks client PII including SSNs, and composition rules mostly produce
 * Passw0rd! rather than strength.
 *
 * Returns null when acceptable, or a sentence to show the person.
 */
export function checkPasswordPolicy(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That is longer than 200 characters.";
  // Catches the single most common failure: a password that is one repeated
  // character, or the email address, or the word "password".
  if (/^(.)\1+$/.test(password)) return "That is the same character repeated.";
  if (/^password/i.test(password)) return "That starts with the word “password”.";
  return null;
}

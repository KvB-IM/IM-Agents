import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * Symmetric encryption for secrets held at rest.
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather
 * than yielding plausible garbage. Used for the Zoho refresh token and for
 * draft SSNs — both are things this app must be able to read back, so they
 * cannot be hashed.
 *
 * Pure and import-free, like coql.ts and password.ts, so it is directly
 * testable under Node's type stripping.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96 bits, the size GCM is specified for
const TAG_LEN = 16;

export class MissingKeyError extends Error {
  constructor() {
    super(
      "APP_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` " +
        "and put it in .env.local (and in the deployment's environment).",
    );
    this.name = "MissingKeyError";
  }
}

/**
 * Derive the 32-byte key from the configured hex string.
 *
 * A hex string of exactly 64 characters is used directly. Anything else is
 * hashed to 32 bytes rather than rejected, so a key generated some other way
 * still works — but the error above asks for the hex form, because a key with
 * full 256-bit entropy is the point and a short passphrase run through SHA-256
 * only has as much entropy as the passphrase.
 */
function keyFrom(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw).digest();
}

function appKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new MissingKeyError();
  return keyFrom(raw);
}

/**
 * Encrypt a string.
 *
 * Output is `v1.<iv>.<tag>.<ciphertext>`, all base64url. Versioned so the
 * algorithm can be changed later without guessing at what old rows contain.
 */
export function encryptSecret(plaintext: string, key: Buffer = appKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a string produced by encryptSecret.
 *
 * Returns null rather than throwing on anything malformed, tampered, or
 * encrypted under a different key. Callers treat that as "no usable secret",
 * which for the Zoho token means falling back to the environment variable — a
 * rotated APP_ENCRYPTION_KEY should degrade to "reconnect Zoho", not to a
 * crash on every request.
 */
export function decryptSecret(payload: string, key: Buffer = appKey()): string | null {
  try {
    const parts = payload.split(".");
    if (parts.length !== 4 || parts[0] !== "v1") return null;

    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const enc = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null;

    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** True when an encryption key is configured. */
export function encryptionConfigured(): boolean {
  return Boolean(process.env.APP_ENCRYPTION_KEY);
}

/** Exposed for tests, so they need no environment. */
export const _keyFrom = keyFrom;

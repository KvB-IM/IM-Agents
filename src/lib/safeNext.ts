/**
 * Sanitise a post-login redirect target.
 *
 * `?next=` arrives from a query string, so without this an attacker can send an
 * agent a link to /login?next=https://evil.example and have the branded,
 * just-trusted app bounce them somewhere they control — the classic open
 * redirect, and a good phishing primitive precisely because the login itself
 * was genuine.
 *
 * Pure and import-free, like coql.ts and password.ts, so it is directly
 * testable. It has exactly one implementation on purpose: it was briefly
 * duplicated between the login page and the login route, which is how one copy
 * quietly loses a case the other still handles.
 */

export const DEFAULT_NEXT = "/quote";

/** Control characters, including the newlines used to smuggle a header. */
const CONTROL = /[\u0000-\u001f\u007f]/;

export function safeNext(next: unknown): string {
  if (typeof next !== "string" || next === "") return DEFAULT_NEXT;
  if (next.length > 512) return DEFAULT_NEXT;

  // Must be a site-relative path.
  if (!next.startsWith("/")) return DEFAULT_NEXT;

  // Protocol-relative URLs. `//evil.example` is a valid absolute URL to a
  // browser and starts with a slash, which is the case people forget.
  if (next.startsWith("//")) return DEFAULT_NEXT;

  // Backslashes: several browsers normalise `/\evil.example` to a
  // protocol-relative URL, so treat any backslash as disqualifying rather than
  // reasoning about which ones are safe.
  if (next.includes("\\")) return DEFAULT_NEXT;

  if (CONTROL.test(next)) return DEFAULT_NEXT;

  // A scheme cannot appear inside the first path segment, so a colon there is
  // someone trying `/javascript:…` or a scheme-smuggling variant.
  const firstSegment = next.slice(1).split(/[/?#]/, 1)[0];
  if (firstSegment.includes(":")) return DEFAULT_NEXT;

  return next;
}

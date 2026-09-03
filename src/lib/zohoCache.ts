import "server-only";

/**
 * The two Zoho token caches, in one place.
 *
 * ── Why they live together ────────────────────────────────────────────────
 * They have to be invalidated together, and they were not. `saveZohoConnection`
 * cleared the refresh-token cache it owned, while the ACCESS token cache lived
 * in zoho.ts and went untouched — so reconnecting the CRM to add scopes
 * appeared to succeed and changed nothing.
 *
 * That is worse than it sounds. An access token carries the scopes it was
 * minted with, and Zoho's live for an hour. So an admin pressing "Reconnect the
 * CRM" to grant attachment access got a green tick, and every attachment call
 * kept failing with a bare 401 until the token happened to expire. Nothing in
 * the app pointed at the cause.
 *
 * Both caches are here, `reset()` clears both, and neither module owns one
 * privately. Kept in its own file rather than in zoho.ts because zohoToken.ts
 * needs to reset it and zoho.ts already imports zohoToken — importing back
 * would be a cycle.
 *
 * ── Why globalThis ───────────────────────────────────────────────────────
 * Next re-evaluates route modules in dev. A module-level cache would refresh
 * the token on every navigation and burn through Zoho's refresh-call limit.
 */

interface Caches {
  /** Access token, minted from the refresh token. Hourly. */
  access: { token: string | null; expiresAt: number; inFlight: Promise<string> | null };
  /** The refresh token itself, read from the encrypted database row. */
  refresh: { token: string | null; apiDomain: string | null; readAt: number };
}

const g = globalThis as unknown as { __imZohoCaches?: Caches };

g.__imZohoCaches ??= {
  access: { token: null, expiresAt: 0, inFlight: null },
  refresh: { token: null, apiDomain: null, readAt: 0 },
};

export const zohoCaches = g.__imZohoCaches;

/**
 * Drop everything. Call after ANY change to the stored connection.
 *
 * Clearing only one of the two is the bug this module exists to prevent, so
 * there is deliberately no way to clear them separately.
 */
export function resetZohoCaches(): void {
  zohoCaches.access = { token: null, expiresAt: 0, inFlight: null };
  zohoCaches.refresh = { token: null, apiDomain: null, readAt: 0 };
}

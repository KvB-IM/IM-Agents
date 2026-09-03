import "server-only";
import { sql, dbConfigured } from "./db";
import { encryptSecret, decryptSecret, encryptionConfigured } from "./crypto";
import { zohoCaches, resetZohoCaches } from "./zohoCache";

/**
 * Where the Zoho refresh token comes from.
 *
 * Exactly one place: the encrypted `zoho_connection` row, written by the OAuth
 * callback. There is deliberately no environment-variable path.
 *
 * There used to be one, inherited from the Self Client design where a callback
 * did not exist and pasting a token was the only option. With a Server-based
 * Application it earned nothing and cost several things: a second source of
 * truth for a credential, a long-lived secret sitting in a Vercel dashboard
 * where project access is enough to read it, and — because it took precedence
 * — a way to silently make the admin Connect button inert.
 *
 * Removing it also removed a whole class of misconfiguration. A live CRM now
 * REQUIRES the database, and the stubbed identity only exists when there is no
 * database, so "every visitor is the same agent, reading real client data"
 * is impossible by construction rather than guarded against at runtime. See
 * lib/session.ts.
 *
 * Cached in-process briefly. Without it every access-token refresh would also
 * cost a database round trip, and the token changes only when somebody
 * reconnects.
 */

/** How long a refresh token read from the database is reused. */
const CACHE_TTL_MS = 60_000;

/* Shared with the access-token cache — see lib/zohoCache.ts for why they are
 * not allowed to live apart. */
const cache = zohoCaches.refresh;

export interface ZohoCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Zoho returns the correct API domain on exchange; prefer it over a guess. */
  apiDomain: string | null;
}

/** True when a client id/secret pair is configured — the part that always
 *  comes from the environment, because it identifies the app itself. */
export function zohoClientConfigured(): boolean {
  return Boolean(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET);
}

/**
 * Resolve the full credential set, or null when the app is not connected.
 *
 * Returning null rather than throwing is deliberate: "not connected to the CRM"
 * is a normal state for a fresh deployment, and it degrades to fixture data
 * with a visible badge rather than an error page.
 */
export async function zohoCredentials(): Promise<ZohoCredentials | null> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (!dbConfigured() || !encryptionConfigured()) return null;

  if (cache.token && Date.now() - cache.readAt < CACHE_TTL_MS) {
    return {
      clientId,
      clientSecret,
      refreshToken: cache.token,
      apiDomain: cache.apiDomain,
    };
  }

  try {
    const db = sql();
    const rows = (await db`
      select refresh_token_cipher, api_domain from zoho_connection where id = true limit 1
    `) as Array<{ refresh_token_cipher: string; api_domain: string | null }>;

    const row = rows[0];
    if (!row) return null;

    const token = decryptSecret(row.refresh_token_cipher);
    if (!token) {
      // Decryption failed — almost always a rotated APP_ENCRYPTION_KEY. Say so
      // loudly, because the symptom otherwise is "the CRM silently went away".
      console.error(
        "[zoho] stored refresh token could not be decrypted. " +
          "APP_ENCRYPTION_KEY has probably changed — an admin needs to reconnect Zoho.",
      );
      return null;
    }

    cache.token = token;
    cache.apiDomain = row.api_domain;
    cache.readAt = Date.now();

    return {
      clientId,
      clientSecret,
      refreshToken: token,
      apiDomain: row.api_domain,
    };
  } catch (err) {
    console.error("[zoho] could not read the stored connection:", err);
    return null;
  }
}

/** Store a refresh token obtained from the OAuth callback. */
export async function saveZohoConnection(opts: {
  refreshToken: string;
  scopes: string | null;
  apiDomain: string | null;
  agentId: string | null;
}): Promise<void> {
  const db = sql();
  const cipher = encryptSecret(opts.refreshToken);

  await db`
    insert into zoho_connection (id, refresh_token_cipher, scopes, api_domain,
                                 connected_at, connected_by, last_error, last_error_at)
    values (true, ${cipher}, ${opts.scopes}, ${opts.apiDomain}, now(), ${opts.agentId},
            null, null)
    on conflict (id) do update
       set refresh_token_cipher = excluded.refresh_token_cipher,
           scopes        = excluded.scopes,
           api_domain    = excluded.api_domain,
           connected_at  = now(),
           connected_by  = excluded.connected_by,
           last_error    = null,
           last_error_at = null
  `;

  /* Invalidate BOTH caches. Clearing only the refresh token left the app
   * holding an access token minted under the OLD scopes — so a reconnect
   * granting attachment access looked successful and every attachment call
   * kept 401ing for up to an hour. */
  resetZohoCaches();
}

/** Record a refresh failure, so a dead connection is visible in the health
 *  check before an agent reports it. */
export async function noteZohoError(message: string): Promise<void> {
  if (!dbConfigured()) return;
  try {
    const db = sql();
    await db`
      update zoho_connection
         set last_error = ${message.slice(0, 500)}, last_error_at = now()
       where id = true
    `;
  } catch {
    /* recording a failure must never itself fail a request */
  }
}

/** Note a successful refresh. Cheap, and it is how you tell a live connection
 *  from one that has not been exercised since it broke. */
export async function noteZohoRefresh(): Promise<void> {
  if (!dbConfigured()) return;
  try {
    const db = sql();
    await db`update zoho_connection set last_refresh_at = now() where id = true`;
  } catch {
    /* best effort */
  }
}

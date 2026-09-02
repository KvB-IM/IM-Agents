import { NextRequest, NextResponse } from "next/server";
import { sql, dbConfigured } from "@/lib/db";
import { saveZohoConnection } from "@/lib/zohoToken";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/zoho/callback — finish the CRM authorisation.
 *
 * Zoho sends the admin's browser here with `code` and `state`. Everything about
 * this route is about not trusting either of them further than it deserves.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const zohoError = params.get("error");

  const fail = (why: string, detail?: string) => {
    if (detail) console.error("[zoho oauth]", detail);
    const url = new URL("/me", request.nextUrl.origin);
    url.searchParams.set("zoho", "error");
    url.searchParams.set("why", why);
    return NextResponse.redirect(url);
  };

  // The admin declined, or Zoho refused — commonly an unregistered redirect URI
  // or a scope the org will not grant.
  if (zohoError) return fail("declined", `Zoho returned error=${zohoError}`);
  if (!code || !state) return fail("incomplete", "callback missing code or state");
  if (!dbConfigured()) return fail("nodb", "callback with no DATABASE_URL");

  const db = sql();

  /* Consume the state atomically. The `consumed_at is null` predicate in the
   * UPDATE is what makes it single-use even if the callback is replayed or
   * arrives twice concurrently — checking then updating would leave a window
   * where both requests see it unconsumed. */
  const claimed = (await db`
    update oauth_states
       set consumed_at = now()
     where state = ${state}
       and consumed_at is null
       and expires_at > now()
    returning agent_id, return_to
  `) as Array<{ agent_id: string | null; return_to: string | null }>;

  const row = claimed[0];
  if (!row) {
    // Unknown, expired, or already used. This is the case that matters: without
    // it, an attacker could hand an admin a callback URL carrying a code from
    // the attacker's own Zoho org and repoint the whole portal at it.
    return fail("state", "state was unknown, expired, or already consumed");
  }

  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("noclient", "client credentials missing");

  const accountsHost = process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.com";
  const redirectUri =
    process.env.ZOHO_REDIRECT_URI ||
    new URL("/api/auth/zoho/callback", request.nextUrl.origin).toString();

  let payload: {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
    api_domain?: string;
    error?: string;
  };

  try {
    const res = await fetch(`${accountsHost}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
      cache: "no-store",
    });
    payload = (await res.json()) as typeof payload;
  } catch (err) {
    return fail("network", `token exchange failed: ${String(err)}`);
  }

  if (payload.error) {
    // `invalid_client` here is almost always a redirect_uri that does not match
    // what is registered, byte for byte, including the scheme and any trailing
    // slash.
    return fail("exchange", `token exchange returned error=${payload.error}`);
  }

  if (!payload.refresh_token) {
    /* An access token with no refresh token. Happens when the authorisation
     * request omitted access_type=offline, or when Zoho skipped the consent
     * screen because this client was already approved — which is exactly why
     * the start route sends prompt=consent. */
    return fail(
      "norefresh",
      "exchange succeeded but returned no refresh_token; check access_type=offline and prompt=consent",
    );
  }

  await saveZohoConnection({
    refreshToken: payload.refresh_token,
    scopes: payload.scope ?? null,
    apiDomain: payload.api_domain ?? null,
    agentId: row.agent_id,
  });

  const url = new URL(safeNext(row.return_to ?? "/me"), request.nextUrl.origin);
  url.searchParams.set("zoho", "connected");
  return NextResponse.redirect(url);
}

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { currentAgentOrNull } from "@/lib/session";
import { sql, dbConfigured } from "@/lib/db";
import { encryptionConfigured } from "@/lib/crypto";
import { zohoClientConfigured, ZOHO_SCOPES } from "@/lib/zohoOauth";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/zoho/start — begin the CRM authorisation.
 *
 * Admin only. Connecting the CRM points the entire portal at one Zoho org, so
 * it is emphatically not a field-agent action.
 *
 * Uses the Server-based Application flow rather than a Self Client, because
 * Zoho permits only ONE Self Client per account and this org already has one.
 * Sharing it would couple this app to whatever else uses it: rotating the
 * secret for either would break the other, and CRM audit logs could not tell
 * the two apart.
 */
export async function GET(request: NextRequest) {
  if (!zohoClientConfigured()) {
    return NextResponse.json(
      { error: "ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET are not configured on this server." },
      { status: 503 },
    );
  }
  if (!dbConfigured()) {
    return NextResponse.json(
      {
        error:
          "A database is required to store the connection. Set DATABASE_URL and run migrations, " +
          "or set ZOHO_REFRESH_TOKEN directly in the environment.",
      },
      { status: 503 },
    );
  }
  if (!encryptionConfigured()) {
    return NextResponse.json(
      { error: "APP_ENCRYPTION_KEY is not set. The refresh token is not stored in plaintext." },
      { status: 503 },
    );
  }

  const agent = await currentAgentOrNull();
  if (!agent) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const db = sql();
  const rows = (await db`
    select is_admin from agents where id = ${agent.id} limit 1
  `) as Array<{ is_admin: boolean }>;

  if (!rows[0]?.is_admin) {
    // 403 rather than 404: the endpoint's existence is not a secret, and an
    // admin who has lost their flag needs to be told that is the problem.
    return NextResponse.json(
      { error: "Only an admin can connect the CRM." },
      { status: 403 },
    );
  }

  /* CSRF state. Without it, an attacker can hand an admin a crafted callback
   * URL carrying an authorisation code from the attacker's OWN Zoho org — and
   * the app would store it, pointing the whole portal at a CRM they control.
   * Single-use, short-lived, and tied to the agent who started the flow. */
  const state = randomBytes(32).toString("base64url");
  const returnTo = safeNext(request.nextUrl.searchParams.get("returnTo") ?? "/me");

  await db`
    insert into oauth_states (state, agent_id, return_to)
    values (${state}, ${agent.id}, ${returnTo})
  `;

  const accountsHost = process.env.ZOHO_ACCOUNTS_HOST || "https://accounts.zoho.com";
  const authorize = new URL(`${accountsHost}/oauth/v2/auth`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", process.env.ZOHO_CLIENT_ID!);
  authorize.searchParams.set("scope", ZOHO_SCOPES.join(","));
  authorize.searchParams.set("redirect_uri", redirectUri(request));
  authorize.searchParams.set("state", state);
  /* offline is what makes Zoho return a refresh_token at all; without it the
   * exchange yields an access token that expires in an hour and nothing to
   * renew it with. `consent` forces the prompt even if the org has approved
   * this client before — otherwise a re-authorisation can come back with no
   * refresh token, which is a genuinely baffling failure. */
  authorize.searchParams.set("access_type", "offline");
  authorize.searchParams.set("prompt", "consent");

  return NextResponse.redirect(authorize.toString());
}

/**
 * The redirect URI, derived from the request rather than configured.
 *
 * It must match what is registered in api-console.zoho.com byte for byte, and
 * deriving it means localhost and the deployment do not need separate
 * variables — but BOTH still have to be registered there.
 */
function redirectUri(request: NextRequest): string {
  const configured = process.env.ZOHO_REDIRECT_URI;
  if (configured) return configured;
  return new URL("/api/auth/zoho/callback", request.nextUrl.origin).toString();
}

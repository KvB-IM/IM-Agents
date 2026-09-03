import { NextRequest, NextResponse } from "next/server";
// From lib/cookies, NOT lib/auth: this file runs on the Edge runtime, and
// auth.ts pulls in node:crypto and the Postgres driver, which do not exist there.
import { SESSION_COOKIE } from "@/lib/cookies";

/**
 * Bounce unauthenticated requests to sign-in.
 *
 * This is a CONVENIENCE, not the security boundary. It only checks that a
 * session cookie is *present* — it cannot validate it, because middleware runs
 * on the edge runtime with no database access. A forged or expired cookie sails
 * through here and is rejected by `requireAgent` in the page or route that
 * actually touches data.
 *
 * Two reasons to keep it anyway: an agent who is signed out lands on the login
 * screen instead of a redirect chain from deep inside the app, and it keeps
 * unauthenticated traffic off the database entirely.
 *
 * Deliberately fails closed on paths it does not recognise — the matcher below
 * is an exclusion list, so a route added later is protected by default rather
 * than exposed until someone remembers to add it.
 */
export function middleware(request: NextRequest) {
  // With no database there are no accounts, so there is nothing to enforce and
  // the app runs on fixtures with a stubbed identity. lib/session.ts refuses
  // that combination in production alongside live CRM credentials.
  if (!process.env.DATABASE_URL) return NextResponse.next();

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(next)}`;

  // API routes get a 401 rather than a redirect: a fetch following a 302 to an
  // HTML login page produces a JSON parse error in the client, which is a
  // confusing way to learn the session expired.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  return NextResponse.redirect(url);
}

export const config = {
  /*
   * Everything except sign-in, the auth endpoints, the health check and static
   * assets. An exclusion list rather than an inclusion list, so a new route is
   * protected the moment it exists.
   *
   * /api/health is public on purpose: it reports which upstreams are
   * configured and how many forms the CRM returns for the stubbed agent, and it
   * is the first thing to check when a deployment misbehaves. It exposes no
   * client data. If that ever changes, take it off this list.
   *
   * /api/cron is excluded because Vercel Cron has NO SESSION COOKIE. Leaving it
   * matched meant the sweep got a 401 from here before its own authorisation
   * ever ran — silently unreachable in production, with a bucket slowly filling
   * with photographs of driver's licences. Those routes authenticate with
   * CRON_SECRET in constant time and refuse outright when it is unset, so they
   * are not unprotected; they are protected differently, and the middleware
   * cannot see it.
   */
  matcher: [
    "/((?!login|api/auth|api/health|api/cron|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

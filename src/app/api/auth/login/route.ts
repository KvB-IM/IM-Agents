import { NextRequest, NextResponse } from "next/server";
import { login, sessionCookie, clientIpFrom } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login
 *
 * Throttling, timing equalisation and the single generic failure message all
 * live in lib/auth.ts — see the comments there for why every failure reads the
 * same. This route is the HTTP shell: validate shapes, set the cookie, and
 * never echo back anything the caller sent.
 */
export async function POST(request: NextRequest) {
  if (!dbConfigured()) {
    return NextResponse.json(
      { error: "Accounts are not set up on this deployment." },
      { status: 503 },
    );
  }

  let body: { email?: unknown; password?: unknown; next?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  // Bound the inputs before they reach a KDF. An unbounded password is a
  // trivial way to make the server do arbitrary scrypt work per request.
  if (!email || email.length > 320 || !password || password.length > 200) {
    return NextResponse.json(
      { error: "That email and password do not match an active account." },
      { status: 401 },
    );
  }

  let result;
  try {
    result = await login(
      email,
      password,
      clientIpFrom(request.headers),
      request.headers.get("user-agent"),
    );
  } catch (err) {
    // The database is unreachable. Say so honestly — an agent standing on a
    // porch needs to know whether to retype the password or call the office,
    // and a generic credential failure would send them down the wrong path.
    console.error("[auth] login failed:", err);
    return NextResponse.json(
      { error: "Sign-in is temporarily unavailable. Try again shortly, or call the office." },
      { status: 503 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: result.message },
      { status: result.retryAfterMinutes ? 429 : 401 },
    );
  }

  // One shared implementation, in lib/safeNext.ts, so this and the login page
  // cannot drift apart on which shapes are dangerous.
  const res = NextResponse.json({ ok: true, next: safeNext(body.next) });
  res.cookies.set(sessionCookie(result.token, result.expiresAt));
  return res;
}

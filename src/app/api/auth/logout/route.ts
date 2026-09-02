import { NextResponse } from "next/server";
import { logout, clearedSessionCookie } from "@/lib/auth";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 *
 * POST rather than GET so a prefetch, an image tag, or a link in an email
 * cannot sign an agent out.
 *
 * Revokes the row AND clears the cookie. Either alone is a bug: clearing only
 * the cookie leaves a valid session anyone holding the token could reuse, and
 * revoking only the row leaves the browser presenting a dead cookie on every
 * request.
 */
export async function POST() {
  if (dbConfigured()) await logout();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearedSessionCookie());
  return res;
}

import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Authorise a Vercel Cron request, or say why not.
 *
 * Vercel Cron has no session; it sends `Authorization: Bearer <CRON_SECRET>`.
 * Compared in constant time, and the endpoint refuses outright when the secret
 * is unset — an unauthenticated delete-things endpoint is worse than no sweep.
 *
 * Returns the response to send when the request is NOT authorised, or null when
 * it is. Shared by every cron route so the check cannot drift between them.
 */
export function cronAuthFailure(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set, so this endpoint is disabled." },
      { status: 503 },
    );
  }
  const offered = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (
    offered.length !== expected.length ||
    !timingSafeEqual(Buffer.from(offered), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }
  return null;
}

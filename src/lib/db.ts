import "server-only";
import { neon } from "@neondatabase/serverless";

/**
 * Postgres, over Neon's HTTP driver.
 *
 * Same client IM-Website uses. HTTP rather than a TCP pool because this runs on
 * serverless functions: a pool per invocation exhausts connections, and the
 * HTTP driver has no connection to leak.
 */

/**
 * Connection-string variables, in preference order.
 *
 * `DATABASE_URL` is what this app documents and what a hand-written .env will
 * use. The rest are what Vercel's storage integrations inject automatically,
 * and which one you get depends on how the database was created — the Neon
 * marketplace integration sets `DATABASE_URL`, while older Vercel Postgres
 * sets `POSTGRES_URL`. Accepting both means "Create Database" in the dashboard
 * just works, instead of the app reporting no database while the dashboard
 * plainly shows one attached.
 *
 * Pooled URLs come first. Every query here is a short HTTP request, which is
 * exactly what a pooler is for.
 */
const POOLED_VARS = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"] as const;

/**
 * Direct (unpooled) variables, preferred for migrations.
 *
 * DDL through a transaction pooler can behave differently from DDL on a direct
 * connection, so `npm run migrate` reaches for these first when they exist.
 */
const DIRECT_VARS = [
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
  "DATABASE_URL",
  "POSTGRES_URL",
] as const;

function firstSet(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value;
  }
  return null;
}

/** The pooled connection string the app runs on, or null. */
export function databaseUrl(): string | null {
  return firstSet(POOLED_VARS);
}

/** The direct connection string, for schema changes. */
export function directDatabaseUrl(): string | null {
  return firstSet(DIRECT_VARS);
}

export function dbConfigured(): boolean {
  return databaseUrl() !== null;
}

/** Which variable is actually supplying the connection — for the health check,
 *  so a misnamed variable is diagnosable rather than mysterious. */
export function databaseUrlSource(): string | null {
  return POOLED_VARS.find((name) => process.env[name]?.trim()) ?? null;
}

/**
 * The tagged-template query function.
 *
 * Interpolations are sent as bound parameters, never spliced into SQL — the
 * opposite of the COQL situation next door, where Zoho gives us no binding and
 * lib/coql.ts has to do the work by hand. Here the driver does it, so use the
 * template form and never build a query by concatenation.
 *
 *   const rows = await sql`select * from agents where id = ${id}`;
 */
export function sql() {
  const url = databaseUrl();
  if (!url) {
    throw new Error(
      `No database connection string. Set DATABASE_URL (or any of ${POOLED_VARS.join(", ")}). ` +
        "Authentication, drafts and the Zoho connection all need Postgres; " +
        "see .env.example, then run `npm run migrate`.",
    );
  }
  return neon(url);
}

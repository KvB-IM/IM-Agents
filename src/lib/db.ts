import "server-only";
import { neon } from "@neondatabase/serverless";

/**
 * Postgres, over Neon's HTTP driver.
 *
 * Same client IM-Website uses. HTTP rather than a TCP pool because this runs on
 * serverless functions: a pool per invocation exhausts connections, and the
 * HTTP driver has no connection to leak.
 *
 * Vercel Postgres and Neon are the same engine, so one DATABASE_URL serves
 * both. Use the pooled connection string here; the direct one is for
 * migrations.
 */

export function dbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
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
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not configured. Authentication and drafts need Postgres; " +
        "see .env.example and apply db/*.sql in order.",
    );
  }
  return neon(url);
}

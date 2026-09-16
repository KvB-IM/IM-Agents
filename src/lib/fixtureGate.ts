/**
 * When may the app serve FIXTURE data instead of the CRM?
 *
 * Pure and import-free so the rule is testable. lib/store.ts applies it.
 *
 * The old behaviour was "whenever Zoho is not configured", and zohoConfigured()
 * is false for more reasons than "no credentials": a revoked refresh token, a
 * rotated APP_ENCRYPTION_KEY, or a Neon read error all made it false. In each
 * case a real submission was written to an in-memory fixture, reported as
 * success, settled the replay buffer as success, and closed the draft — while
 * nothing reached Zoho. The agent saw a green tick; the office saw nothing.
 *
 * So fixtures are allowed in exactly two situations:
 *   1. There is NO database at all — the credential-free iPad demo the README
 *      describes, where nothing real can exist to be lost.
 *   2. ALLOW_FIXTURE_DATA=true, outside production — local UI work with a
 *      database but no CRM connection.
 * Anything else is "the CRM is unavailable", and a write must FAIL so the
 * replay buffer keeps it for the office.
 */
export function fixturesAllowed(env: {
  databaseConfigured: boolean;
  allowFixtureData: string | undefined;
  nodeEnv: string | undefined;
}): boolean {
  if (!env.databaseConfigured) return true;
  return env.allowFixtureData === "true" && env.nodeEnv !== "production";
}

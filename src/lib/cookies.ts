/**
 * The session cookie's name, and nothing else.
 *
 * Its own module with ZERO imports because `middleware.ts` needs it and
 * middleware runs on the Edge runtime. Importing it from `auth.ts` dragged
 * `node:crypto`, `server-only` and the Postgres driver into that bundle, none
 * of which exist there — the build reported it as "Ecmascript file had an
 * error" against lib/password.ts, which is a long way from the actual cause.
 *
 * Anything else the middleware ever needs to know belongs here too, not in
 * auth.ts.
 */
export const SESSION_COOKIE = "im_agent_session";

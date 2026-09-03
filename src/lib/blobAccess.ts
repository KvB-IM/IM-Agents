/**
 * Blob constants shared by the client upload and the server token route.
 *
 * Both values live here for the same reason: the two sides must agree, and a
 * disagreement is reported by the browser as an unexplained CORS error rather
 * than as the mismatch it is. The blob API returns rejections without CORS
 * headers, so the real reason never reaches the console.
 *
 * Import-free, so a client component and a route handler can both use it.
 */

/**
 * Private, not public.
 *
 * A photograph of somebody's driver's licence must not be readable by anyone
 * who happens to have the link. The server reads it back with credentials and
 * forwards the bytes to Zoho.
 *
 * A client declaring `public` against a token issued for `private` is rejected
 * outright — that cost a debugging round before this became one constant.
 */
export const BLOB_ACCESS = "private" as const;

/**
 * Every staged upload goes under this prefix.
 *
 * Two things depend on it, which is why the CLIENT builds the path rather than
 * the server rewriting it:
 *
 *   * the sweep lists only this prefix, so it cannot delete anything else
 *   * `isStagedUrl` requires it, so the forward endpoint cannot be pointed at
 *     an arbitrary blob
 *
 * The token route's `pathname` option turned out NOT to override what the
 * client asked for — the file landed at the client's path and the guard
 * rightly refused it. So the client prefixes, and the server VALIDATES rather
 * than rewrites. Validating is the correct shape anyway: a rewrite that
 * silently fails is indistinguishable from one that works.
 */
export const STAGING_PREFIX = "staged/licenses/";

import "server-only";
import { hsFetch } from "./healthsherpa";
import { draftToEnrollmentSession } from "./enrollmentSessionPayload";
import type { EnrollmentFlow, EnrollmentSessionLinks } from "./enrollmentSessionPayload";
import type { CaptureDraft } from "./types";

/**
 * Creating a HealthSherpa enrollment session, and the flags that gate it.
 *
 * The payload itself lives in enrollmentSessionPayload.ts — pure, so it is
 * tested without a key or a network. It was also accepted live on 2026-09-08;
 * that file records the response and what it reveals about the deep link.
 *
 * Re-exported here so callers have one import for the handoff.
 */

export type { EnrollmentFlow, EnrollmentSessionLinks };
export { draftToEnrollmentSession, isEnrollmentFlow, DEFAULT_FLOW } from "./enrollmentSessionPayload";

/** True when the HealthSherpa handoff is switched on for this deployment. */
export function hsHandoffEnabled(): boolean {
  return process.env.NEXT_PUBLIC_HS_ENROLLMENT_ENABLED === "true";
}

/**
 * Mock mode. Returns the exact payload the real path would send, without
 * calling out — the only way to exercise this while the endpoint 403s.
 *
 * Hard-gated off in production for the same reason IM-Website's is: the payload
 * is a household's name, date of birth and income. There is no SSN in it (the
 * endpoint has no such field), but that is not a reason to echo the rest back
 * from a live deploy.
 */
export function hsMockEnabled(): boolean {
  return process.env.HS_ENROLLMENT_MOCK === "true" && process.env.NODE_ENV !== "production";
}

/**
 * Create the session and return its deep links.
 *
 * Throws `HealthSherpaUpstreamError` on any non-2xx, which already carries a
 * sentence written for a person — including the specific one for this endpoint's
 * 403, which is the state of the account today.
 */
export async function createEnrollmentSession(
  draft: CaptureDraft,
  formId: string,
  flow?: EnrollmentFlow,
): Promise<EnrollmentSessionLinks> {
  const body = draftToEnrollmentSession(draft, formId, flow);

  const data = (await hsFetch("/v1/enrollment-sessions", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { links?: { client_apply_url?: string; shopping_url?: string } };

  const clientApplyUrl = data?.links?.client_apply_url;
  if (!clientApplyUrl) {
    /* A 2xx with no link is not something to paper over: the agent is with the
     * client and needs to know to finish another way. */
    throw new Error("HealthSherpa returned no application link.");
  }

  return { clientApplyUrl, shoppingUrl: data.links?.shopping_url ?? null };
}

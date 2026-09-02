import "server-only";

/**
 * Server-side HealthSherpa One API client.
 *
 * Ported from IM-Website/src/lib/healthsherpa.ts, which is working in
 * production against a self-serve key. The key is read exclusively from
 * HEALTHSHERPA_API_KEY and never leaves the server: browsers call our own
 * /api/* routes, and only this module talks to api.one.healthsherpa.com.
 *
 * Contract source of truth: https://one.healthsherpa.com/openapi.json
 */

const HS_ORIGIN = "https://api.one.healthsherpa.com";

/** True when no key is configured, so callers can fall back to fixtures. */
export function hsConfigured(): boolean {
  return Boolean(process.env.HEALTHSHERPA_API_KEY);
}

export class HealthSherpaUpstreamError extends Error {
  constructor(
    public status: number,
    public userMessage: string,
    detail?: string,
  ) {
    super(detail ?? userMessage);
    this.name = "HealthSherpaUpstreamError";
  }
}

function userMessageForStatus(status: number, detail?: string): string {
  if (status === 401 || status === 403) {
    if (detail?.includes("not authorized to access this endpoint")) {
      // The live state of the account today: quoting is enabled, enrollment is
      // not. Phase 2 in SOFTWARE_SCOPE.md.
      return "This HealthSherpa capability is not enabled for our account yet. Quoting works; enrollment API access must be requested through HealthSherpa onboarding.";
    }
    return "The HealthSherpa API key was rejected. Check that HEALTHSHERPA_API_KEY is set to a valid key.";
  }
  if (status === 429) return "HealthSherpa rate limit reached. Wait a moment and try again.";
  if (status >= 500) return "HealthSherpa is having trouble right now. Try again shortly.";
  return "The request was rejected by HealthSherpa. Check the inputs and try again.";
}

export async function hsFetch(path: string, init?: RequestInit): Promise<unknown> {
  const apiKey = process.env.HEALTHSHERPA_API_KEY;
  if (!apiKey) {
    throw new HealthSherpaUpstreamError(500, "HEALTHSHERPA_API_KEY is not configured.");
  }

  const res = await fetch(`${HS_ORIGIN}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      detail = typeof body?.error === "string" ? body.error : JSON.stringify(body);
    } catch {
      /* non-JSON error body */
    }
    throw new HealthSherpaUpstreamError(res.status, userMessageForStatus(res.status, detail), detail);
  }

  return res.json();
}

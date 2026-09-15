/**
 * The office phone number, pinned in one place.
 *
 * Same number IM-Website publishes (src/lib/site.ts) and the one HealthSherpa
 * shows on the agency's white-label pages. Pure and import-free so the
 * derivation below is testable: what the screen SHOWS and what the phone
 * DIALS are computed from one string, so they cannot drift apart — a
 * "Call office" button that quietly dials a different number than it displays
 * is the kind of bug nobody reports, they just stop pressing it.
 */

/** As printed for a person. */
export const OFFICE_PHONE_DISPLAY = "(803) 761-0222";

/** E.164, derived — never typed separately. */
export const OFFICE_PHONE_TEL = `+1${OFFICE_PHONE_DISPLAY.replace(/\D/g, "")}`;

/** The href. `tel:` hands off to the dialer and leaves the page where it is. */
export const OFFICE_PHONE_HREF = `tel:${OFFICE_PHONE_TEL}`;

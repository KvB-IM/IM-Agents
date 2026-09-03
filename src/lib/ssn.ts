/**
 * SSN handling.
 *
 * Pure and import-free, like coql.ts and password.ts, so the formatting and
 * validation rules are directly testable. Drafts hold raw digits; the dashes
 * are presentation, and the dashed form is what goes to Zoho — existing JOTS
 * records are stored as XXX-XX-XXXX.
 */

/** Strip everything that is not a digit, capped at nine. */
export function ssnDigits(raw: string): string {
  return (raw ?? "").replace(/\D/g, "").slice(0, 9);
}

/** XXX-XX-XXXX, as Zoho stores it. Empty when incomplete. */
export function formatSsn(raw: string): string {
  const d = ssnDigits(raw);
  if (d.length !== 9) return "";
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/**
 * The display value while typing: every digit masked except the most recent.
 *
 * The last digit stays visible so the agent can confirm the keystroke landed —
 * on a touch keyboard, entering nine digits completely blind is how a
 * transposition survives all the way to the carrier. The dashes are laid in as
 * the digits arrive so the shape of the number is legible even masked.
 *
 *   "1"         -> "1"
 *   "12345"     -> "•••-•5"
 *   "123456789" -> "•••-••-•••9"
 */
export function maskedSsn(raw: string, dot = "•"): string {
  const d = ssnDigits(raw);
  if (d.length === 0) return "";

  const shown = d
    .split("")
    .map((ch, i) => (i === d.length - 1 ? ch : dot))
    .join("");

  const a = shown.slice(0, 3);
  const b = shown.slice(3, 5);
  const c = shown.slice(5, 9);
  return [a, b, c].filter((part) => part.length > 0).join("-");
}

/**
 * Why an SSN is not acceptable yet, or null when it is.
 *
 * Structural checks only — the ones the Marketplace itself rejects, so an
 * application is not filed knowing it will bounce:
 *   * area number 000, 666, or 900-999 was never issued
 *   * group and serial cannot be all zeroes
 * Deliberately NOT a check that the number belongs to the applicant; that is
 * the exchange's job and not something this app can know.
 */
export function ssnProblem(raw: string): string | null {
  const d = ssnDigits(raw);
  if (d.length === 0) return "An SSN is required.";
  if (d.length < 9) return `${9 - d.length} more digit${9 - d.length === 1 ? "" : "s"} needed.`;

  const area = d.slice(0, 3);
  const group = d.slice(3, 5);
  const serial = d.slice(5);

  if (area === "000" || area === "666" || Number(area) >= 900) {
    return "That area number was never issued. Check the first three digits.";
  }
  if (group === "00") return "The middle two digits cannot be 00.";
  if (serial === "0000") return "The last four digits cannot be 0000.";
  return null;
}

/** True when both entries are complete, valid and identical. */
export function ssnConfirmed(entry: string, confirm: string): boolean {
  const a = ssnDigits(entry);
  const b = ssnDigits(confirm);
  return a.length === 9 && ssnProblem(a) === null && a === b;
}

/**
 * Apply an input event to the real digits.
 *
 * The <input> shows the MASK, not the number, so a change event cannot simply
 * be read as the new value — the field's content is mostly dots. What it can
 * be read as is a delta against the mask we last rendered.
 *
 * The first attempt at this stripped the dots and treated anything longer than
 * one character as a paste. That broke every keystroke: with a mask of "•1",
 * typing "2" gives "•12", which strips to "12" — two characters, so it looked
 * like a paste and replaced the whole number instead of appending. The result
 * was a field that never held more than two digits while appearing to work.
 *
 * Extracted here, away from the component, because that bug was invisible to a
 * unit test of the formatter and only showed up when driving the real input.
 *
 * @param raw           the input element's value after the event
 * @param currentDigits the true digits held in state
 */
export function applySsnInput(raw: string, currentDigits: string): string {
  const digits = ssnDigits(currentDigits);
  const mask = maskedSsn(digits);

  if (raw === mask) return digits;

  // Shorter than what we rendered: a backspace or a cut.
  if (raw.length < mask.length) return digits.slice(0, -1);

  // Extends what we rendered: the tail is what was typed. This is the ordinary
  // keystroke path and has to come before any paste handling.
  if (raw.startsWith(mask)) {
    const added = raw.slice(mask.length).replace(/\D/g, "");
    return ssnDigits(digits + added);
  }

  // Does not extend the mask and contains no mask characters: a paste or an
  // autofill over the whole field. Take its digits.
  if (!raw.includes("\u2022")) return ssnDigits(raw);

  // Anything else is uninterpretable — a paste spliced into the middle of the
  // mask. Leaving the value alone is better than guessing at an SSN.
  return digits;
}

/**
 * How an SSN reads on the review screen: last four only.
 *
 * Different from `maskedSsn`, which is the WHILE-TYPING view and shows the most
 * recent digit. On review the agent is confirming a number they entered several
 * screens ago, and the last four is what a client can verify out loud without
 * the whole number being on a screen in someone's living room.
 */
export function ssnSummary(raw: string): string {
  const d = ssnDigits(raw);
  if (d.length === 0) return "";
  if (d.length < 9) return `Incomplete — ${d.length} of 9 digits`;
  return `•••-••-${d.slice(5)}`;
}

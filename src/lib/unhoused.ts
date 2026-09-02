import type { CaptureDraft, Person } from "./types";

/**
 * Answers the application asks that have NO dedicated Jot field.
 *
 * ── Why this exists rather than just not asking ───────────────────────────
 * Each of these is a question on HealthSherpa's application that the office
 * currently chases by phone. Capturing them at the table is the whole point of
 * this app, and waiting for Zoho fields to be created before asking means the
 * office keeps chasing them in the meantime.
 *
 * So they are asked, and written into `Agent_Notes` as a clearly delimited
 * block. That is deliberately not pretending to be structured data: the block
 * is easy for a person to read, easy to spot, and easy to stop generating once
 * real fields exist.
 *
 * ── What to replace it with ──────────────────────────────────────────────
 * Five picklists on JOTS, all Yes/No/Unknown, would retire this file:
 *
 *   Wants_Cost_Savings          "Do you want to see if you qualify for savings?"
 *   Medicare_Enrolled_Or_Soon   Enrolled in Part A or C, or will be in 3 months
 *   Claimed_As_Dependent        Will be claimed as a tax dependent by someone else
 *   Cares_For_Under_19          Cares for a child under 19 not on this application
 *   Everyone_Same_Address       Does everyone applying live at this address
 *
 * A sixth, on the Jot_Dependents SUBFORM, would retire the pregnancy overflow:
 *
 *   Pregnant                    Yes/No, per dependent
 *
 * Pure and import-free apart from types, so it is testable.
 */

/** Marker so the block can be found, re-read, or stripped later. */
export const NOTES_BLOCK_START = "--- Captured in the field (no CRM field yet) ---";
export const NOTES_BLOCK_END = "--- end ---";

interface Line {
  question: string;
  answer: string;
}

function personLabel(p: Person, index: number): string {
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  if (name) return name;
  if (p.relation === "primary") return "Primary applicant";
  return `Household member ${index + 1}`;
}

/**
 * Build the note block, or "" when there is nothing to say.
 *
 * Returns empty rather than a header with no content — an empty marker block on
 * every Jot trains the office to ignore it.
 */
export function unhousedAnswers(draft: CaptureDraft): string {
  const lines: Line[] = [];

  const ask = (question: string, answer: string) => {
    if (answer && answer.trim() !== "") lines.push({ question, answer });
  };

  ask("Wants to check for cost savings", draft.wantsCostSavings);
  ask(
    "Enrolled in Medicare Part A or C, or will be within 3 months",
    draft.medicareEnrolledOrSoon,
  );
  ask("Will be claimed as a tax dependent by someone else", draft.claimedAsDependent);
  ask("Cares for a child under 19 who is not on this application", draft.caresForUnder19);
  ask("Everyone applying lives at the home address", draft.everyoneSameAddress);

  /* Pregnancy for anyone other than the primary. The primary's answer has a
   * real field; the subform has no column, so a pregnant spouse or dependent
   * would otherwise be captured and then silently dropped. */
  const primary = draft.people.find((p) => p.relation === "primary") ?? draft.people[0];
  draft.people.forEach((person, i) => {
    if (person === primary) return;
    if (!person.pregnant) return;
    lines.push({
      question: `Pregnant — ${personLabel(person, i)}`,
      answer: person.pregnant,
    });
  });

  /* An attested "never issued an SSN" for a dependent. The parent record has
   * No_SSN_Attestation; the subform does not, so the same gap applies. */
  draft.people.forEach((person, i) => {
    if (person === primary) return;
    if (!person.noSsn) return;
    lines.push({
      question: `No SSN ever issued — ${personLabel(person, i)}`,
      answer: "Attested",
    });
  });

  if (lines.length === 0) return "";

  const width = Math.max(...lines.map((l) => l.question.length));
  const body = lines.map((l) => `${l.question.padEnd(width)}  ${l.answer}`).join("\n");
  return [NOTES_BLOCK_START, body, NOTES_BLOCK_END].join("\n");
}

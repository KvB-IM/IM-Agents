/**
 * How many forms an agent has filed: today, yesterday, this week, all time.
 *
 * Pure and import-free, like kpis' other helpers would be if kpis.ts were not
 * `server-only`, so the day arithmetic is testable — and it needs to be,
 * because "today" is a TIMEZONE question, not a Date one. The server runs in
 * UTC; the agents are in South Carolina. A form filed at 9pm Eastern is
 * "today" to the agent and "tomorrow" to `toISOString()`. Every boundary here
 * is computed in the office's zone.
 */

/** The agency's zone. One constant, because every boundary depends on it. */
export const OFFICE_TIME_ZONE = "America/New_York";

/** Monday. The work week, which is how an office counts "this week". */
const WEEK_STARTS_ON = "Mon";

export interface SubmissionCounts {
  today: number;
  yesterday: number;
  thisWeek: number;
  total: number;
}

const DAY_MS = 86_400_000;

function dayKey(d: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function weekday(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
}

export function submissionCounts(
  jots: ReadonlyArray<{ submittedAt: string }>,
  now: Date = new Date(),
  tz: string = OFFICE_TIME_ZONE,
): SubmissionCounts {
  const today = dayKey(now, tz);
  const yesterday = dayKey(new Date(now.getTime() - DAY_MS), tz);

  /* Walk back to the most recent week start, in the office zone. At most six
   * steps; done by weekday name rather than arithmetic so DST cannot shift it. */
  let weekStart = today;
  for (let back = 0; back < 7; back++) {
    const d = new Date(now.getTime() - back * DAY_MS);
    if (weekday(d, tz) === WEEK_STARTS_ON) {
      weekStart = dayKey(d, tz);
      break;
    }
  }

  const counts: SubmissionCounts = { today: 0, yesterday: 0, thisWeek: 0, total: 0 };
  for (const jot of jots) {
    counts.total++;
    const t = new Date(jot.submittedAt);
    if (Number.isNaN(t.getTime())) continue; // counted in total, undatable otherwise
    const key = dayKey(t, tz);
    if (key === today) counts.today++;
    if (key === yesterday) counts.yesterday++;
    if (key >= weekStart && key <= today) counts.thisWeek++;
  }
  return counts;
}

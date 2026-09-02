/**
 * Special Enrollment Period qualifying events.
 *
 * All 28 values from HealthSherpa's `SpecialEnrollmentPeriod.event_type` enum
 * (`openapi.json`). The capture form previously offered six, which meant an
 * agent picked "Other" for a loss-of-coverage that has its own code — and the
 * office then had to work out which event it really was from a note.
 *
 * `Enrollment_Event` on the Jot is a TEXT field, not a picklist, so there is no
 * silent-drop hazard here and the stored value can be a readable label. The
 * HealthSherpa enum is carried alongside it because Phase 2's enrollment
 * session needs the machine value, and deriving one from the other later would
 * be guesswork.
 *
 * Grouped because 28 flat options in a phone-sized select is unusable. The
 * groups follow how an agent thinks about the conversation, not how the enum
 * happens to be ordered.
 */

export interface EnrollmentEvent {
  /** HealthSherpa's `event_type`. Phase 2 sends this. */
  hs: string;
  /** Written to `Enrollment_Event` (text) and shown to the agent. */
  label: string;
  /** True when the event has a documented 60-day window on the application. */
  window60?: boolean;
}

export interface EnrollmentEventGroup {
  title: string;
  events: EnrollmentEvent[];
}

export const ENROLLMENT_EVENT_GROUPS: EnrollmentEventGroup[] = [
  {
    title: "Lost coverage",
    events: [
      { hs: "loss_of_mec", label: "Lost qualifying health coverage", window60: true },
      { hs: "dependent_lost_coverage", label: "A dependent lost coverage", window60: true },
      { hs: "loss_of_dependent", label: "Lost a dependent", window60: true },
      { hs: "loss_of_pregnancy_coverage", label: "Lost pregnancy-related coverage", window60: true },
      {
        hs: "end_of_non_calendar_year_policy",
        label: "A non-calendar-year policy is ending",
        window60: true,
      },
      { hs: "lost_aptc", label: "Lost the premium tax credit", window60: true },
    ],
  },
  {
    title: "Household change",
    events: [
      { hs: "marriage", label: "Got married", window60: true },
      { hs: "divorce", label: "Divorced or legally separated", window60: true },
      { hs: "domestic_partnership", label: "Entered a domestic partnership", window60: true },
      { hs: "birth", label: "Had a baby", window60: true },
      { hs: "adoption", label: "Adopted, or placed for adoption or foster care", window60: true },
      { hs: "pregnancy", label: "Pregnancy" },
      { hs: "death", label: "A death in the household", window60: true },
      { hs: "child_support", label: "Child-support or other court order", window60: true },
      { hs: "mandated_covered_dependent", label: "Court-ordered to cover a dependent", window60: true },
      { hs: "change_in_household_status", label: "Other change in household status", window60: true },
    ],
  },
  {
    title: "Moved",
    events: [
      { hs: "relocation", label: "Moved to a new area", window60: true },
      { hs: "nj_county_change", label: "Changed county within New Jersey", window60: true },
    ],
  },
  {
    title: "Employer arrangement",
    events: [
      { hs: "offered_ichra", label: "Offered an ICHRA" },
      { hs: "offered_qsehra", label: "Offered a QSEHRA" },
    ],
  },
  {
    title: "Status change",
    events: [
      { hs: "released_from_incarceration", label: "Released from incarceration", window60: true },
      { hs: "returning_active_duty", label: "Returning from active duty", window60: true },
      { hs: "domestic_abuse", label: "Survivor of domestic abuse or spousal abandonment" },
      {
        hs: "family_care_app_ineligible",
        label: "Found ineligible for Medicaid or CHIP",
        window60: true,
      },
    ],
  },
  {
    title: "Plan or process failure",
    events: [
      {
        hs: "provider_not_participating_in_prior_plan",
        label: "Provider left the plan's network mid-year",
      },
      { hs: "issuer_violated_contract", label: "The carrier violated its contract" },
      { hs: "misinformed", label: "Misinformed or misled about coverage" },
    ],
  },
  {
    title: "Other",
    events: [{ hs: "other", label: "Something else" }],
  },
];

/** Flat list, for lookups. */
export const ENROLLMENT_EVENTS: EnrollmentEvent[] = ENROLLMENT_EVENT_GROUPS.flatMap(
  (g) => g.events,
);

/** Find an event by the label stored on the Jot. */
export function eventByLabel(label: string): EnrollmentEvent | undefined {
  return ENROLLMENT_EVENTS.find((e) => e.label === label);
}

/** Find an event by HealthSherpa's enum value. */
export function eventByHsValue(hs: string): EnrollmentEvent | undefined {
  return ENROLLMENT_EVENTS.find((e) => e.hs === hs);
}

/**
 * True when the event must have happened within the last 60 days.
 *
 * The application says so explicitly for most events, and an agent capturing a
 * qualifying event three months old is filing something the exchange will
 * refuse. Advisory rather than blocking: the window has exceptions, and a form
 * the office can chase beats one the agent could not submit.
 */
export function outsideSixtyDayWindow(label: string, eventDate: string): boolean {
  const event = eventByLabel(label);
  if (!event?.window60 || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return false;
  const then = Date.parse(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(then)) return false;
  return (Date.now() - then) / 86_400_000 > 60;
}

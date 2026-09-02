import { test } from "node:test";
import assert from "node:assert/strict";
import * as PL from "../src/lib/picklists.ts";
import {
  ENROLLMENT_EVENTS,
  ENROLLMENT_EVENT_GROUPS,
  eventByLabel,
  outsideSixtyDayWindow,
} from "../src/lib/enrollmentEvents.ts";

/*
 * Zoho silently drops a picklist value that is not on the field's option list —
 * no error, a 2xx response, and the field simply arrives empty. Three bugs of
 * that shape shipped before these values were pinned, so the guard gets tests.
 */

test("pinned passes a value that is on the list", () => {
  assert.equal(PL.pinned(PL.PREGNANT, "N/A"), "N/A");
  assert.equal(PL.pinned(PL.ICHRA_STATUS, "Offered - Not Accepted"), "Offered - Not Accepted");
  assert.equal(PL.pinned(PL.ENROLLMENT_TYPE, "Open Enrollment"), "Open Enrollment");
});

test("pinned blanks a value that is not, so the allowlist drops it", () => {
  // An empty field is visibly empty; a value Zoho swallowed looks like the
  // agent never answered.
  assert.equal(PL.pinned(PL.PREGNANT, "Maybe"), "");
  assert.equal(PL.pinned(PL.ICHRA_STATUS, "Offered"), "");
  assert.equal(PL.pinned(PL.ENROLLMENT_TYPE, "SEP"), "");
  assert.equal(PL.pinned(PL.PREGNANT, ""), "");
  assert.equal(PL.pinned(PL.PREGNANT, null), "");
});

test("pinned is case- and whitespace-exact, as Zoho is", () => {
  assert.equal(PL.pinned(PL.PREGNANT, "yes"), "");
  assert.equal(PL.pinned(PL.PREGNANT, "Yes "), "");
});

test("the three values that were silently dropped are now on their lists", () => {
  // Jot_Dependents.Coverage is Yes/No — it was being sent Covered/Not Covered.
  assert.equal(PL.pinned(PL.DEPENDENT_COVERAGE, "Yes"), "Yes");
  assert.equal(PL.pinned(PL.DEPENDENT_COVERAGE, "Covered"), "");

  // Jot_Dependents.Relation offers "Other Dependent", not "Other".
  assert.equal(PL.pinned(PL.DEPENDENT_RELATION, "Other Dependent"), "Other Dependent");
  assert.equal(PL.pinned(PL.DEPENDENT_RELATION, "Other"), "");

  // Type_of_Existing_Coverage never had Employer / Marketplace / COBRA.
  assert.equal(PL.pinned(PL.TYPE_OF_EXISTING_COVERAGE, "Other Carrier"), "Other Carrier");
  for (const bad of ["Employer", "Marketplace", "COBRA", "Other"]) {
    assert.equal(PL.pinned(PL.TYPE_OF_EXISTING_COVERAGE, bad), "", bad);
  }
});

/* ── Enrollment events ──────────────────────────────────────────────────── */

test("all 28 HealthSherpa event types are present", () => {
  assert.equal(ENROLLMENT_EVENTS.length, 28);
  const hs = new Set(ENROLLMENT_EVENTS.map((e) => e.hs));
  assert.equal(hs.size, 28, "duplicate hs values");
  for (const required of [
    "birth", "adoption", "death", "divorce", "marriage", "domestic_partnership",
    "child_support", "loss_of_mec", "loss_of_dependent", "dependent_lost_coverage",
    "loss_of_pregnancy_coverage", "end_of_non_calendar_year_policy",
    "change_in_household_status", "lost_aptc", "relocation", "nj_county_change",
    "offered_ichra", "offered_qsehra", "mandated_covered_dependent",
    "released_from_incarceration", "returning_active_duty",
    "provider_not_participating_in_prior_plan", "issuer_violated_contract",
    "misinformed", "domestic_abuse", "family_care_app_ineligible", "pregnancy", "other",
  ]) {
    assert.ok(hs.has(required), `missing ${required}`);
  }
});

test("labels are unique — they are what gets stored on the Jot", () => {
  const labels = ENROLLMENT_EVENTS.map((e) => e.label);
  assert.equal(new Set(labels).size, labels.length, "duplicate label");
});

test("every event belongs to exactly one group", () => {
  const counted = ENROLLMENT_EVENT_GROUPS.reduce((n, g) => n + g.events.length, 0);
  assert.equal(counted, 28);
});

test("a stored label round-trips to its HealthSherpa value", () => {
  // Phase 2's enrollment session needs the machine value, and deriving it from
  // the label later would be guesswork.
  assert.equal(eventByLabel("Got married")?.hs, "marriage");
  assert.equal(eventByLabel("Lost qualifying health coverage")?.hs, "loss_of_mec");
  assert.equal(eventByLabel("not an event"), undefined);
});

test("the 60-day window is advisory and only for events that have one", () => {
  const old = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

  assert.equal(outsideSixtyDayWindow("Got married", old), true);
  assert.equal(outsideSixtyDayWindow("Got married", recent), false);
  // Pregnancy has no 60-day limit on the application.
  assert.equal(outsideSixtyDayWindow("Pregnancy", old), false);
  // Unknown event or missing date says nothing.
  assert.equal(outsideSixtyDayWindow("not an event", old), false);
  assert.equal(outsideSixtyDayWindow("Got married", ""), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { rankProviders } from "../src/lib/providerRank.ts";

const p = (name: string, distance: number | null) => ({ name, distance });

test("nearest first — CMS's own order is not distance", () => {
  /* The real case: searching "Ban" near Mesa AZ put Banning Dialysis, 292
     miles away in California, above the Banner hospitals two miles away. */
  const ranked = rankProviders([
    p("Banning Dialysis", 292),
    p("BANNER DESERT MEDICAL CENTER", 2),
    p("BANNER HOME CARE-ARIZONA", 0),
  ]);
  assert.deepEqual(ranked.map((h) => h.name), [
    "BANNER HOME CARE-ARIZONA",
    "BANNER DESERT MEDICAL CENTER",
    "Banning Dialysis",
  ]);
});

test("a provider with no distance sorts LAST, not first", () => {
  // Null is not zero. Treating it as zero put unlocatable records above the
  // clinic in the client's own town.
  const ranked = rankProviders([p("No location given", null), p("Local clinic", 6)]);
  assert.deepEqual(ranked.map((h) => h.name), ["Local clinic", "No location given"]);
});

test("ties break by name, so the list is stable across searches", () => {
  const hits = [p("Zeta Clinic", 6), p("Alpha Clinic", 6)];
  assert.deepEqual(rankProviders(hits).map((h) => h.name), ["Alpha Clinic", "Zeta Clinic"]);
  assert.deepEqual(rankProviders(hits), rankProviders(hits));
});

test("the limit is applied after sorting, so the nearest survive it", () => {
  const far = Array.from({ length: 50 }, (_, i) => p(`Far ${i}`, 200 + i));
  const ranked = rankProviders([...far, p("Next door", 1)], 3);
  assert.equal(ranked[0].name, "Next door");
  assert.equal(ranked.length, 3);
});

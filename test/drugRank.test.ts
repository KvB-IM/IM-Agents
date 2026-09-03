import { test } from "node:test";
import assert from "node:assert/strict";
import { relevanceTier, rankDrugs } from "../src/lib/drugRank.ts";

const d = (name: string, strength = "") => ({ name, strength });

test("an exact name beats a combination product that merely starts the same", () => {
  // CMS's own order puts the combinations first; this is the whole point.
  assert.equal(relevanceTier("metFORMIN", "metformin"), 0);
  assert.equal(relevanceTier("metFORMIN/SITagliptin", "metformin"), 1);
  assert.ok(relevanceTier("metFORMIN", "metformin") < relevanceTier("metFORMIN/SITagliptin", "metformin"));
});

test("case and punctuation do not matter — CMS writes metFORMIN", () => {
  assert.equal(relevanceTier("metFORMIN", "MetFormin"), 0);
  assert.equal(relevanceTier("ELIQUIS 30-DAY STARTER PACK", "eliquis"), 1);
});

test("a whole word inside a brand name ranks below a prefix", () => {
  assert.equal(relevanceTier("ACTOPLUS MET", "met"), 2);
  assert.ok(relevanceTier("ACTOPLUS MET", "met") > relevanceTier("metFORMIN", "met"));
});

test("a match on nothing in the name ranks last", () => {
  // JANUMET matched because its full_name contains metformin hydrochloride.
  assert.equal(relevanceTier("JANUMET", "metformin"), 4);
});

test("plain metformin surfaces ahead of the combinations", () => {
  /* The real first page from CMS for "metformin", plus the plain entry that
     sits past result 25. It has to come first. */
  const hits = [
    d("ACTOPLUS MET", "850-15 mg"),
    d("metFORMIN/Pioglitazone", "850-15 mg"),
    d("JANUMET", "500-50 mg"),
    d("metFORMIN/SITagliptin", "500-50 mg"),
    d("metFORMIN", "500 mg"),
    d("metFORMIN", "1,000 mg"),
    d("GLUCOPHAGE", "850 mg"),
  ];
  const ranked = rankDrugs(hits, "metformin");
  assert.deepEqual(
    ranked.slice(0, 2).map((h) => `${h.name} ${h.strength}`),
    ["metFORMIN 500 mg", "metFORMIN 1,000 mg"],
  );
  // And the pure-brand match is not promoted above a real name match.
  assert.ok(ranked.findIndex((h) => h.name === "JANUMET") > 1);
});

test("strengths sort numerically, not as text", () => {
  const ranked = rankDrugs(
    [d("metFORMIN", "1,000 mg"), d("metFORMIN", "500 mg"), d("metFORMIN", "850 mg")],
    "metformin",
  );
  assert.deepEqual(ranked.map((h) => h.strength), ["500 mg", "850 mg", "1,000 mg"]);
});

test("the limit is applied after ranking, not before", () => {
  // 30 irrelevant hits then the exact one: it must survive a limit of 3.
  const hits = [...Array.from({ length: 30 }, (_, i) => d(`JANUMET ${i}`, "")), d("metFORMIN", "500 mg")];
  const ranked = rankDrugs(hits, "metformin", 3);
  assert.equal(ranked[0].name, "metFORMIN");
  assert.equal(ranked.length, 3);
});

test("ranking is stable, so a repeat search does not reshuffle", () => {
  const hits = [d("BRAND A", "5 mg"), d("BRAND B", "5 mg"), d("BRAND C", "5 mg")];
  assert.deepEqual(rankDrugs(hits, "zzz"), rankDrugs(hits, "zzz"));
});

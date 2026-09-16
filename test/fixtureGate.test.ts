import { test } from "node:test";
import assert from "node:assert/strict";
import { fixturesAllowed } from "../src/lib/fixtureGate.ts";

/* The silent path this guards: a real submission "succeeding" into an
 * in-memory fixture because zohoConfigured() happened to be false. */

test("no database at all: fixtures are the documented demo", () => {
  assert.equal(fixturesAllowed({ databaseConfigured: false, allowFixtureData: undefined, nodeEnv: "production" }), true);
});

test("with a database, fixtures need to be asked for", () => {
  assert.equal(fixturesAllowed({ databaseConfigured: true, allowFixtureData: undefined, nodeEnv: "development" }), false);
  assert.equal(fixturesAllowed({ databaseConfigured: true, allowFixtureData: "true", nodeEnv: "development" }), true);
  assert.equal(fixturesAllowed({ databaseConfigured: true, allowFixtureData: "yes", nodeEnv: "development" }), false);
});

test("in production with a database, fixtures are never allowed — even if asked for", () => {
  assert.equal(fixturesAllowed({ databaseConfigured: true, allowFixtureData: "true", nodeEnv: "production" }), false);
});

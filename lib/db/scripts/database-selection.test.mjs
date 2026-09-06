import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  envVariablePrefix,
  requireDatabaseUrl,
  selectDatabaseVariableName,
} from "../database-url.mjs";

test("explicitly selects DATABASE_URL", () => {
  assert.deepEqual(
    requireDatabaseUrl({
      DATABASE_URL_VARIABLE: "DATABASE_URL",
      DATABASE_URL: "postgresql://database.example/selected",
      NEON_DATABASE_URL: "postgresql://neon.example/not-selected",
    }),
    {
      variableName: "DATABASE_URL",
      url: "postgresql://database.example/selected",
    },
  );
});

test("explicitly selects NEON_DATABASE_URL", () => {
  assert.deepEqual(
    requireDatabaseUrl({
      DATABASE_URL_VARIABLE: "NEON_DATABASE_URL",
      DATABASE_URL: "postgresql://database.example/not-selected",
      NEON_DATABASE_URL: "postgresql://neon.example/selected",
    }),
    {
      variableName: "NEON_DATABASE_URL",
      url: "postgresql://neon.example/selected",
    },
  );
});

test("accepts the prefixed DATABASE_URL provided by Vercel", () => {
  const prefixedName = `${envVariablePrefix}DATABASE_URL`;
  assert.deepEqual(
    requireDatabaseUrl({
      DATABASE_URL_VARIABLE: "DATABASE_URL",
      [prefixedName]: "postgresql://database.example/prefixed",
    }),
    {
      variableName: prefixedName,
      url: "postgresql://database.example/prefixed",
    },
  );
});

test("accepts a prefixed name as the database selector", () => {
  const prefixedName = `${envVariablePrefix}DATABASE_URL`;
  assert.deepEqual(
    requireDatabaseUrl({
      DATABASE_URL_VARIABLE: prefixedName,
      [prefixedName]: "postgresql://database.example/prefixed-selector",
    }),
    {
      variableName: prefixedName,
      url: "postgresql://database.example/prefixed-selector",
    },
  );
});

test("defaults to DATABASE_URL on Vercel", () => {
  assert.equal(selectDatabaseVariableName({ VERCEL: "1" }), "DATABASE_URL");
});

test("defaults to NEON_DATABASE_URL outside Vercel", () => {
  assert.equal(selectDatabaseVariableName({}), "NEON_DATABASE_URL");
});

test("rejects unsupported selector values", () => {
  assert.throws(
    () => selectDatabaseVariableName({ DATABASE_URL_VARIABLE: "OTHER_URL" }),
    /must be DATABASE_URL or NEON_DATABASE_URL/,
  );
});

test("rejects a missing selected variable instead of falling back", () => {
  assert.throws(
    () =>
      requireDatabaseUrl({
        DATABASE_URL_VARIABLE: "DATABASE_URL",
        NEON_DATABASE_URL: "postgresql://neon.example/must-not-fallback",
      }),
    /DATABASE_URL must be set/,
  );
});

const databaseEnvironmentKeys = [
  "DATABASE_URL",
  "NEON_DATABASE_URL",
  "DATABASE_URL_VARIABLE",
  "VERCEL",
  "RELEASE_CHECK_EMAIL",
];

function runReleaseCheck(script, environment) {
  const cleanEnvironment = { ...process.env };
  for (const key of databaseEnvironmentKeys) delete cleanEnvironment[key];

  return spawnSync(process.execPath, [script], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env: { ...cleanEnvironment, ...environment },
  });
}

for (const [name, script] of [
  ["release record", "./scripts/check-release-records.mjs"],
  ["production schema", "./scripts/check-production-schema.mjs"],
]) {
  test(`${name} check names the selected variable without exposing sensitive values`, () => {
    const unselectedUrl = "postgresql://account@example.test/private-database";
    const accountEmail = "private-account@example.test";
    const result = runReleaseCheck(script, {
      DATABASE_URL_VARIABLE: "DATABASE_URL",
      NEON_DATABASE_URL: unselectedUrl,
      RELEASE_CHECK_EMAIL: accountEmail,
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /set DATABASE_URL, the selected database variable/);
    assert.doesNotMatch(result.stderr, /private-database|private-account@example\.test/);
  });
}
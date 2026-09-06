import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  auditRulesets,
  REQUIRED_CHECK,
} from "./audit-main-release-ruleset.mjs";

const releaseWebKitWorkflow = new URL(
  "../.github/workflows/release-webkit-pwa.yml",
  import.meta.url,
);

function ruleset(rules) {
  return {
    enforcement: "active",
    target: "branch",
    conditions: { ref_name: { include: ["refs/heads/main"], exclude: [] } },
    rules,
  };
}

const pullRequest = { type: "pull_request", parameters: {} };
const requiredChecks = {
  type: "required_status_checks",
  parameters: {
    strict_required_status_checks_policy: true,
    required_status_checks: [{ context: "WebKit private-storage warning" }],
  },
};

test("release audit requires the hosted WebKit workflow job name", async () => {
  const workflow = await readFile(releaseWebKitWorkflow, "utf8");
  const hostedJobName = workflow.match(
    /^\s{4}name:\s*(.+?)\s*$/m,
  )?.[1];

  assert.ok(
    hostedJobName,
    "Could not find the hosted job name in .github/workflows/release-webkit-pwa.yml",
  );
  assert.equal(
    REQUIRED_CHECK,
    hostedJobName,
    `Release check name drift: the ruleset audit requires "${REQUIRED_CHECK}", but the hosted WebKit workflow reports "${hostedJobName}". Rename both together.`,
  );
});

test("accepts an active main ruleset with the complete release gate", () => {
  assert.deepEqual(auditRulesets([ruleset([pullRequest, requiredChecks])]), []);
});

test("reports each missing release protection clearly", () => {
  assert.deepEqual(auditRulesets([ruleset([])]), [
    "pull-request enforcement is missing for main",
    "required status checks are missing for main",
  ]);
  assert.deepEqual(
    auditRulesets([
      ruleset([
        pullRequest,
        {
          ...requiredChecks,
          parameters: {
            strict_required_status_checks_policy: false,
            required_status_checks: [{ context: "A renamed check" }],
          },
        },
      ]),
    ]),
    [
      "branches are not required to be up to date before merging",
      'required status check "WebKit private-storage warning" is missing',
    ],
  );
});

test("ignores inactive rulesets and rulesets that do not target main", () => {
  const inactive = { ...ruleset([pullRequest, requiredChecks]), enforcement: "disabled" };
  const otherBranch = {
    ...ruleset([pullRequest, requiredChecks]),
    conditions: { ref_name: { include: ["refs/heads/develop"], exclude: [] } },
  };
  assert.deepEqual(auditRulesets([inactive, otherBranch]), [
    "no active branch ruleset targets main",
    "pull-request enforcement is missing for main",
    "required status checks are missing for main",
  ]);
});

test("accepts GitHub wildcard and special-token inclusions that target main", () => {
  for (const include of [["refs/heads/*"], ["refs/heads/**"], ["~ALL"], ["~DEFAULT_BRANCH"]]) {
    const wildcard = {
      ...ruleset([pullRequest, requiredChecks]),
      conditions: { ref_name: { include, exclude: [] } },
    };
    assert.deepEqual(auditRulesets([wildcard]), []);
  }
});

test("does not trust a ruleset when a wildcard excludes main", () => {
  const excluded = {
    ...ruleset([pullRequest, requiredChecks]),
    conditions: {
      ref_name: {
        include: ["refs/heads/main"],
        exclude: ["refs/heads/*"],
      },
    },
  };
  assert.deepEqual(auditRulesets([excluded]), [
    "no active branch ruleset targets main",
    "pull-request enforcement is missing for main",
    "required status checks are missing for main",
  ]);
});

test("fails closed for unsupported pattern syntax", () => {
  const unsupported = {
    ...ruleset([pullRequest, requiredChecks]),
    conditions: {
      ref_name: { include: ["refs/heads/{main,release}"], exclude: [] },
    },
  };
  assert.match(auditRulesets([unsupported])[0], /no active branch ruleset/);
});
#!/usr/bin/env node

export const REQUIRED_CHECK = "WebKit private-storage warning";

export function auditRulesets(rulesets, defaultBranch = "main") {
  const matching = rulesets.filter(
    (ruleset) =>
      ruleset.enforcement === "active" &&
      ruleset.target === "branch" &&
      targetsMain(ruleset.conditions?.ref_name, defaultBranch),
  );

  const failures = [];
  if (matching.length === 0) {
    failures.push("no active branch ruleset targets main");
  }

  const pullRequestRule = matching
    .flatMap((ruleset) => ruleset.rules ?? [])
    .find((rule) => rule.type === "pull_request");
  if (!pullRequestRule) {
    failures.push("pull-request enforcement is missing for main");
  }

  const statusRule = matching
    .flatMap((ruleset) => ruleset.rules ?? [])
    .find((rule) => rule.type === "required_status_checks");
  if (!statusRule) {
    failures.push("required status checks are missing for main");
  } else {
    if (!statusRule.parameters?.strict_required_status_checks_policy) {
      failures.push("branches are not required to be up to date before merging");
    }
    const contexts = statusRule.parameters?.required_status_checks ?? [];
    if (!contexts.some((check) => check.context === REQUIRED_CHECK)) {
      failures.push(`required status check "${REQUIRED_CHECK}" is missing`);
    }
  }

  return failures;
}

function targetsMain(condition, defaultBranch) {
  const include = condition?.include ?? [];
  const exclude = condition?.exclude ?? [];
  const ref = "refs/heads/main";
  const patterns = [...include, ...exclude];

  // Fail closed when GitHub introduces or an operator uses pattern syntax this
  // audit cannot evaluate confidently.
  if (patterns.some((pattern) => !isSupportedPattern(pattern))) return false;

  return (
    include.some((pattern) => matchesRef(pattern, ref, defaultBranch)) &&
    !exclude.some((pattern) => matchesRef(pattern, ref, defaultBranch))
  );
}

function isSupportedPattern(pattern) {
  return (
    pattern === "~ALL" ||
    pattern === "~DEFAULT_BRANCH" ||
    !/[{}()!+@\\]/.test(pattern)
  );
}

function matchesRef(pattern, ref, defaultBranch) {
  if (pattern === "~ALL") return true;
  if (pattern === "~DEFAULT_BRANCH") {
    return ref === `refs/heads/${defaultBranch}`;
  }

  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end === -1) return false;
      const content = pattern.slice(index + 1, end);
      expression += `[${content.replace(/^!/, "^")}]`;
      index = end;
    } else {
      expression += character.replace(/[.$^|[\]()]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`).test(ref);
}

async function github(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "ezyretire-release-ruleset-audit",
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API returned ${response.status} for ${path}. Confirm the token can read repository administration rules.`,
    );
  }
  return response.json();
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) {
    console.error(
      "GITHUB_TOKEN and GITHUB_REPOSITORY (owner/repository) are required. The token needs read access to repository administration rules.",
    );
    process.exitCode = 2;
    return;
  }

  const repositoryDetails = await github(`/repos/${repository}`, token);
  const summaries = await github(`/repos/${repository}/rulesets?per_page=100`, token);
  const rulesets = await Promise.all(
    summaries.map((ruleset) =>
      github(`/repos/${repository}/rulesets/${ruleset.id}`, token),
    ),
  );
  const failures = auditRulesets(rulesets, repositoryDetails.default_branch);

  if (failures.length > 0) {
    console.error("Release ruleset audit failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Release ruleset audit passed: main requires pull requests, up-to-date branches, and "${REQUIRED_CHECK}".`,
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error(`Release ruleset audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
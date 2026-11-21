#!/usr/bin/env node
/**
 * Lint gate (BUG-053).
 *
 * ESLint has been configured in this repository since the project was
 * created, and it has never been enforced: `.github/workflows/ci.yml` did not
 * run it, and turning it on as-is fails with 1,154 errors - 1,119 of them
 * `@typescript-eslint/no-explicit-any`, almost all of them `ctx: any` in the
 * Convex layer, plus 285 `no-unused-vars`.
 *
 * There are two honest ways to close that gap, and this script takes the
 * second:
 *
 *   1. Fix all 1,154 errors, then enable the gate. That is weeks of work
 *      that cannot be done as part of a CI change, and until it is finished
 *      the gate does not exist.
 *   2. Record the current findings as an accepted baseline, and make the
 *      gate fail on NEW problems only.
 *
 * The second is what this script does. The rules stay exactly as they are -
 * nothing is deleted and nothing is disabled - the backlog stays visible and
 * measurable, and the codebase cannot get worse while it is worked off.
 *
 * The baseline is a committed file (`scripts/lint-baseline.json`) holding the
 * number of findings per rule per file. A file that gains a finding, or gains
 * an extra finding of the same rule, fails the gate. A file that loses one
 * is reported as an improvement; the baseline is not rewritten automatically,
 * because a baseline that shrinks itself is a baseline nobody trusts.
 *
 * Usage:
 *   node scripts/lint-baseline.mjs            # check against the baseline
 *   node scripts/lint-baseline.mjs --write    # rewrite the baseline
 *   node scripts/lint-baseline.mjs --paths src,convex
 *
 * Exit codes: 0 = no new problems, 1 = new problems found, 2 = the script
 * could not run.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { ESLint } from "eslint";

/** The committed baseline. */
const BASELINE_PATH = resolve("scripts/lint-baseline.json");

/** What is linted. Kept in one place so the baseline and the gate agree. */
const DEFAULT_TARGETS = ["src", "convex", "scripts"];

function toPosix(path) {
  return path.split(sep).join("/");
}

function relativeToRepo(path) {
  return toPosix(relative(process.cwd(), path));
}

/**
 * Turns ESLint's results into a flat count of findings per file and rule.
 *
 * The count is what makes the comparison stable. A rule that fires twice in
 * one file is two findings; a rule that moves from line 10 to line 40 is
 * still one finding. Comparing positions would produce a diff on every
 * unrelated edit, which is exactly how a gate gets switched off.
 *
 * A parse error has no rule id. It is recorded under "fatal", because a file
 * that does not parse is a problem that must fail the gate whatever the
 * rules say.
 */
function countFindings(results) {
  const perFile = new Map();
  const byRule = new Map();
  let total = 0;

  for (const result of results) {
    const file = relativeToRepo(result.filePath);
    if (result.messages.length === 0) continue;

    const rules = perFile.get(file) ?? {};
    for (const message of result.messages) {
      const rule = message.ruleId ?? "fatal";
      rules[rule] = (rules[rule] ?? 0) + 1;
      byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
      total += 1;
    }
    perFile.set(file, rules);
  }

  return { perFile, byRule, total };
}

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || !parsed.files) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function lint(targets) {
  const eslint = new ESLint({ cwd: process.cwd() });
  // The API resolves the flat config in eslint.config.mjs exactly as the
  // command line does, so this gate and `npx eslint` see the same rules.
  const results = await eslint.lintFiles(targets);
  return { results, counts: countFindings(results) };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        write: { type: "boolean", default: false },
        paths: { type: "string", default: "" },
      },
    });
  } catch (error) {
    process.stderr.write(`lint-baseline: ${error.message}\n`);
    return 2;
  }

  const targets = parsed.values.paths
    ? parsed.values.paths.split(",").map((entry) => entry.trim()).filter(Boolean)
    : DEFAULT_TARGETS;

  let linted;
  try {
    linted = await lint(targets);
  } catch (error) {
    process.stderr.write(`lint-baseline: ESLint failed to run: ${error.message}\n`);
    return 2;
  }

  const { results, counts } = linted;
  const lintedFiles = results.length;

  if (parsed.values.write) {
    const baseline = {
      version: 1,
      generatedAt: new Date().toISOString(),
      targets,
      totals: {
        files: lintedFiles,
        problems: counts.total,
        byRule: Object.fromEntries(
          [...counts.byRule.entries()].sort((a, b) => b[1] - a[1]),
        ),
      },
      files: Object.fromEntries(
        [...counts.perFile.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      ),
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    process.stdout.write(
      `Wrote the baseline: ${counts.total} finding(s) across ${counts.perFile.size} file(s) -> ${relativeToRepo(BASELINE_PATH)}\n`,
    );
    return 0;
  }

  const baseline = readBaseline();
  if (!baseline) {
    process.stderr.write(
      "lint-baseline: no usable baseline. Create one with: node scripts/lint-baseline.mjs --write\n",
    );
    return 2;
  }

  // ---- compare ------------------------------------------------------
  // A finding is NEW when the current count for a (file, rule) pair is
  // higher than the count the baseline recorded. A lower count is an
  // improvement; a missing file is a deletion; neither fails the gate.
  const newProblems = [];
  let fixed = 0;

  for (const [file, rules] of counts.perFile) {
    const baselineRules = baseline.files[file] ?? {};
    for (const [rule, count] of Object.entries(rules)) {
      const baselineCount = baselineRules[rule] ?? 0;
      if (count > baselineCount) {
        newProblems.push({
          file,
          rule,
          count,
          baselineCount,
          delta: count - baselineCount,
        });
      } else {
        fixed += baselineCount - count;
      }
    }
  }

  newProblems.sort((a, b) => b.delta - a.delta || a.file.localeCompare(b.file));

  const out = [];
  out.push("lint-baseline: lint gate");
  out.push(`  linted          : ${lintedFiles} file(s) in ${targets.join(", ")}`);
  out.push(`  findings now   : ${counts.total}`);
  out.push(
    `  baseline       : ${baseline.totals?.problems ?? "?"} finding(s) recorded on ${baseline.generatedAt ?? "unknown date"}`,
  );
  out.push("");

  if (newProblems.length === 0) {
    out.push(
      `PASS: no new lint problems (${fixed} finding(s) fixed since the baseline).`,
    );
    process.stdout.write(out.join("\n") + "\n");
    return 0;
  }

  out.push(`FAIL: ${newProblems.length} new lint problem(s):`);
  for (const problem of newProblems) {
    out.push(
      `  ${problem.file}  ${problem.rule}  +${problem.delta} (baseline ${problem.baselineCount})`,
    );
  }
  out.push("");
  out.push(
    "Either fix the new problems, or - if the new findings are the same kind of debt that already exists - accept them with:",
  );
  out.push("  node scripts/lint-baseline.mjs --write");
  process.stdout.write(out.join("\n") + "\n");
  return 1;
}

process.exit(await main());

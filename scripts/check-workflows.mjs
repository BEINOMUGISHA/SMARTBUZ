#!/usr/bin/env node
/**
 * SMARTBUZ — check the workflow files.
 *
 * A workflow file that GitHub cannot parse is rejected *before* a single
 * job starts. Nothing runs, no step fails, and the run is marked "failed"
 * with no jobs and no reason — which is exactly what happened to this
 * repository's CI between the day it was written and the day it was
 * noticed. The gates it was written to enforce had never once run.
 *
 * So the workflows are checked here, in a script that fails loudly:
 *
 *   • every file parses as YAML;
 *   • every job has something to do — steps or a reusable workflow;
 *   • every step says what to run — `run:` or `uses:`;
 *   • every step has a name, so a failing step can be read;
 *   • every job a job depends on exists;
 *   • every `uses:` refers to a file that is there.
 *
 * The check runs in CI's configuration pre-flight and can be run by hand.
 * It is deliberately strict: a workflow it cannot understand is a workflow
 * that will not run.
 *
 * It prints the names of things and never the value of a secret.
 *
 * Usage: node scripts/check-workflows.mjs
 */

import { readFile, readdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");

/** The reusable actions this repository is allowed to call from a file. */
const LOCAL_ACTION_PREFIXES = ["./", ".github/"];

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every workflow file in the repository.
 */
async function workflowFiles() {
  let names;
  try {
    names = await readdir(WORKFLOW_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => path.join(WORKFLOW_DIR, name));
}

/**
 * The problems in one workflow file.
 *
 * @returns {string[]} one line per problem; empty when the file is sound.
 */
async function problemsIn(file) {
  const relative = path.relative(ROOT, file);
  const problems = [];
  const source = await readFile(file, "utf8");

  let workflow;
  try {
    workflow = yaml.load(source);
  } catch (error) {
    problems.push(`${relative}: the file is not valid YAML — ${error.message}`);
    return problems;
  }

  if (!workflow || typeof workflow !== "object") {
    problems.push(`${relative}: the file does not describe a workflow.`);
    return problems;
  }

  // `on` is a key in YAML 1.2 but a boolean in YAML 1.1, and js-yaml
  // follows 1.1. The triggers are under `true` there.
  const triggers = workflow.on ?? workflow[true];
  if (!triggers) {
    problems.push(`${relative}: the workflow says when it runs nowhere ("on:" is missing).`);
  }

  if (!workflow.name) {
    problems.push(`${relative}: the workflow has no name.`);
  }

  const jobs = workflow.jobs ?? {};
  const jobNames = Object.keys(jobs);
  if (jobNames.length === 0) {
    problems.push(`${relative}: the workflow defines no jobs.`);
    return problems;
  }

  for (const [jobName, job] of Object.entries(jobs)) {
    const where = `${relative}: job "${jobName}"`;

    if (!job["runs-on"] && !job.uses) {
      problems.push(`${where}: it says nothing about where it runs ("runs-on:" is missing).`);
    }

    if (job.needs) {
      const needed = Array.isArray(job.needs) ? job.needs : [job.needs];
      for (const dependency of needed) {
        if (!jobNames.includes(dependency)) {
          problems.push(`${where}: it waits on "${dependency}", which is not a job in this file.`);
        }
      }
    }

    if (job.uses) {
      // A job that calls a reusable workflow. Nothing else to check.
      continue;
    }

    const steps = job.steps ?? [];
    if (steps.length === 0) {
      problems.push(`${where}: it has no steps, so it does nothing.`);
      continue;
    }

    for (const [index, step] of steps.entries()) {
      const stepWhere = `${where}, step ${index + 1}`;

      if (!step.run && !step.uses) {
        problems.push(
          `${stepWhere} ("${step.name ?? "unnamed"}"): it says nothing to run — a step needs "run:" or "uses:".`
        );
        continue;
      }

      if (!step.name) {
        problems.push(`${stepWhere}: it has no name, so a failure could not be read.`);
      }

      if (step.run !== undefined && typeof step.run !== "string") {
        problems.push(`${stepWhere}: "run:" must be a command.`);
      }
      if (step.run !== undefined && step.run.trim() === "") {
        problems.push(`${stepWhere}: "run:" is empty.`);
      }
      if (step.uses !== undefined && step.run !== undefined) {
        problems.push(`${stepWhere}: it has both "run:" and "uses:" — a step does one or the other.`);
      }

      if (typeof step.uses === "string" && LOCAL_ACTION_PREFIXES.some((p) => step.uses.startsWith(p))) {
        const target = path.resolve(ROOT, step.uses);
        if (!(await exists(target))) {
          problems.push(`${stepWhere}: it calls "${step.uses}", which is not in the repository.`);
        }
      }
    }
  }

  return problems;
}

async function main() {
  const files = await workflowFiles();
  if (files.length === 0) {
    console.error("check-workflows: no workflow files found.");
    process.exit(1);
  }

  const problems = [];
  for (const file of files) {
    problems.push(...(await problemsIn(file)));
  }

  console.log("check-workflows: workflow files");
  console.log(`  checked        : ${files.length} file(s)`);

  if (problems.length === 0) {
    console.log("");
    console.log("PASS: every workflow can be run.");
    return;
  }

  console.log(`  problems       : ${problems.length}`);
  console.log("");
  for (const problem of problems) console.log(`  ${problem}`);
  console.log("");
  console.log(
    "FAIL: GitHub rejects a workflow it cannot parse before any job starts,\n" +
      "and the run is marked failed with no jobs and no reason. A gate that\n" +
      "never runs is not a gate."
  );
  process.exit(1);
}

await main();

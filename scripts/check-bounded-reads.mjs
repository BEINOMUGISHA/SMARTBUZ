#!/usr/bin/env node
/**
 * SMARTBUZ — find the reads that load a whole table to serve one page.
 *
 * The performance audit (PERF-02, DB-02) found that not one of the 352
 * `.collect()` sites in the backend was bounded, and named the worst
 * pattern: a query that reads the tenant's entire history and then throws
 * all but one page away. The cost of a page of twenty rows grew with the
 * tenant's whole history.
 *
 * This script finds that pattern. It is the instrument the fix is measured
 * with, and the gate that stops it coming back.
 *
 *   node scripts/check-bounded-reads.mjs
 *   node scripts/check-bounded-reads.mjs --verbose
 *
 * A read is "read-then-slice" when the result of a `.collect()` is
 * materialised into a variable and that variable is later cut down with
 * `.slice(` — either to take a page or to take the first few of a list.
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONVEX_DIR = path.join(ROOT, "convex");

/**
 * The most a read may cost, in rows, before it is called unbounded.
 *
 * A catalogue is expected to be read whole — a business has hundreds of
 * products, and the reports that value them need all of them. A ledger of
 * every sale ever made is not.
 */
const PAGE_PATTERN = /\.slice\(\s*[^)]*(?:offset|start|cursor|limit|numItems)[^)]*\)/g;

/** Every TypeScript file under convex/. */
async function convexFiles(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_generated") continue;
      found.push(...(await convexFiles(full)));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The variables a `.collect()` was assigned to.
 *
 * The assignment and the `.collect()` are often on different lines, so the
 * search runs backwards from the `.collect()` to the nearest `const`/`let`
 * above it.
 */
function collectedVariables(source) {
  const names = [];
  const pattern = /\.collect\(\)/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const before = source.slice(0, match.index);
    const declaration = before.lastIndexOf("\n");

    // Walk back over the assignment, which may be several lines long.
    const window = before.slice(Math.max(0, declaration - 600), declaration + 1);
    const assignment = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/.exec(window);

    if (assignment) names.push({ name: assignment[1], at: match.index });
  }

  return names;
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const files = await convexFiles(CONVEX_DIR);

  let totalCollects = 0;
  let totalTakes = 0;
  const offenders = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(ROOT, file);

    totalCollects += (source.match(/\.collect\(\)/g) ?? []).length;
    totalTakes += (source.match(/\.take\(\s*\d+\s*\)/g) ?? []).length;

    for (const { name, at } of collectedVariables(source)) {
      // The uses of the variable that come after it was collected.
      const uses = source.slice(at);
      const sliced = uses.match(PAGE_PATTERN);
      if (!sliced) continue;

      const line = source.slice(0, at).split("\n").length;
      offenders.push({ file: relative, line, name, slices: sliced.length });
    }
  }

  offenders.sort((a, b) => b.slices - a.slices);

  console.log(`files scanned : ${files.length}`);
  console.log(`.collect() sites: ${totalCollects}`);
  console.log(`.take(n) sites : ${totalTakes}`);
  console.log(`read-then-slice: ${offenders.length}`);
  console.log("");

  if (offenders.length === 0) {
    console.log("PASS: no read is loaded whole in order to serve one page.");
    return;
  }

  console.log("Reads that load a whole table to serve one page:");
  for (const offender of offenders) {
    console.log(
      `  ${offender.file}:${offender.line}  "${offender.name}" sliced ${offender.slices}×`
    );
  }

  if (!verbose) {
    console.log("");
    console.log("Run with --verbose for the full list.");
  }
}

await main();

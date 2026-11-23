#!/usr/bin/env node
/**
 * SMARTBUZ — find the reads that will grow without end.
 *
 * A business's catalogue — its products, its customers, its branches — is
 * bounded by the size of the business. A ledger is not: every sale, every
 * payment, every shift and every audit row is one more row, forever.
 *
 * So the reads that matter are the ones that take a whole ledger when
 * they only need part of it. This script lists them, table by table, so
 * that the fix can be aimed.
 *
 *   node scripts/check-ledger-reads.mjs
 */

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONVEX_DIR = path.join(ROOT, "convex");

/**
 * The tables that only ever grow.
 *
 * A read of one of these is a read of something that is bigger every
 * month.
 */
const LEDGERS = new Set([
  "sales",
  "expenses",
  "incomeRecords",
  "payments",
  "stockLedger",
  "stockCostHistory",
  "activityLogs",
  "auditLogs",
  "cashMovements",
  "shifts",
  "loans",
  "loanPayments",
  "notifications",
  "syncLogs",
  "emailVerifications",
  "passwordResets",
  "transactionLogs",
  "inventoryLogs",
  "posTransactions",
  "mobileMoneyRequests",
  "purchaseOrderItems",
  "supplierInvoices",
  "supplierPayments",
  "customerInvoices",
  "customerPayments",
  "classBookings",
  "appointments",
  "rentals",
  "serviceTickets",
]);

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
 * The table each `.collect()` reads, and the index it goes through.
 *
 * The query is read backwards from the `.collect()` so that a multi-line
 * chain is understood as one statement.
 */
function collectSites(source) {
  const sites = [];
  const pattern = /\.collect\(\)/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    const before = source.slice(0, match.index);

    const query = /\.query\(\s*"([A-Za-z_]+)"\s*\)/g;
    let lastQuery = null;
    let qMatch;
    while ((qMatch = query.exec(before)) !== null) lastQuery = qMatch;

    if (!lastQuery) continue;

    const chain = before.slice(lastQuery.index, match.index);
    const index = /\.withIndex\(\s*"([^"]+)"/.exec(chain);
    const search = /\.withSearchIndex\(\s*"([^"]+)"/.exec(chain);

    // Did the query narrow the rows it reads?
    const range =
      /\.gte\(|\.lte\(|\.gt\(|\.lt\(/.test(chain) ||
      /\.filter\(/.test(chain);

    sites.push({
      table: lastQuery[1],
      index: index?.[1] ?? (search?.[1] ?? null),
      narrowed: range,
      at: match.index,
    });
  }

  return sites;
}

async function main() {
  const files = await convexFiles(CONVEX_DIR);
  const findings = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relative = path.relative(ROOT, file);

    for (const site of collectSites(source)) {
      if (!LEDGERS.has(site.table)) continue;
      if (site.narrowed) continue;

      const line = source.slice(0, site.at).split("\n").length;
      findings.push({ file: relative, line, table: site.table, index: site.index });
    }
  }

  findings.sort((a, b) => a.table.localeCompare(b.table) || a.file.localeCompare(b.file));

  const byTable = new Map();
  for (const finding of findings) {
    byTable.set(finding.table, (byTable.get(finding.table) ?? 0) + 1);
  }

  console.log(`ledger tables read whole: ${findings.length}`);
  console.log("");

  for (const [table, count] of [...byTable.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(3)}  ${table}`);
  }

  console.log("");
  console.log("Where:");
  for (const finding of findings) {
    console.log(`  ${finding.file}:${finding.line}  ${finding.table} via ${finding.index ?? "no index"}`);
  }
}

await main();

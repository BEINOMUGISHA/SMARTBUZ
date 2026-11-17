/**
 * SMARTBUZ — test runner.
 *
 * The permission tests are plain TypeScript run against Node's built-in
 * test runner. They import the *real* backend modules (`convex/rbac.ts`,
 * `convex/tenancy.ts`), which means the TypeScript has to be resolved and
 * bundled before Node can run it — Node's own type stripping does not
 * resolve extensionless relative imports.
 *
 * esbuild (already present as a Next.js dependency) does that bundling in
 * a few milliseconds. The bundle is written to `.test-build/` and executed
 * with `node --test`.
 *
 * Usage:
 *   node scripts/run-tests.mjs            # run everything
 *   node scripts/run-tests.mjs acceptance # run the files matching "acceptance"
 */
import { build } from "esbuild";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TESTS_DIR = path.join(ROOT, "tests");
const OUT_DIR = path.join(ROOT, ".test-build");

const filter = process.argv[2];

/** Every `*.test.ts` under tests/. */
function findTests(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "helpers") continue;
      found.push(...findTests(full));
    } else if (entry.name.endsWith(".test.ts")) {
      found.push(full);
    }
  }
  return found;
}

let tests = findTests(TESTS_DIR).sort();
if (filter) {
  tests = tests.filter((file) => file.includes(filter));
}

if (tests.length === 0) {
  console.error(
    filter ? `No test files match "${filter}".` : "No test files found."
  );
  process.exit(1);
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

console.log(`Bundling ${tests.length} test file(s) with esbuild…\n`);

for (const file of tests) {
  const outfile = path.join(OUT_DIR, path.relative(TESTS_DIR, file).replace(/\.ts$/, ".mjs"));
  fs.mkdirSync(path.dirname(outfile), { recursive: true });

  await build({
    entryPoints: [file],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: "inline",
    logLevel: "warning",
    // Node's built-in test runner is provided by the runtime, not bundled.
    external: ["node:*"],
    banner: {
      js: [
        "import { createRequire as __createRequire } from 'node:module';",
        "const require = __createRequire(import.meta.url);",
      ].join("\n"),
    },
  });
}

console.log("Running tests…\n");

const child = spawn(
  process.execPath,
  ["--test", "--test-reporter=spec", ...tests.map((file) =>
    path.join(OUT_DIR, path.relative(TESTS_DIR, file).replace(/\.ts$/, ".mjs"))
  )],
  { cwd: ROOT, stdio: "inherit" }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});

/**
 * SMARTBUZ — prove that a deployment is serving a given commit's code.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this exists
 *
 * `npx convex deploy` publishes to the *production* deployment of the
 * Convex project. The web app does not necessarily point there: this
 * installation's app runs on the pinned deployment `affable-panda-681`.
 * A deploy to the wrong deployment reports success, the job goes green,
 * and the app keeps running the old code — which is exactly what happened
 * on 21 Nov 2026.
 *
 * So the deploy has to be proved, not assumed.
 *
 * ────────────────────────────────────────────────────────────────────────
 * How the proof works
 *
 * The functions this commit defines are read out of the *source* — the
 * files in `convex/` — and the deployment is asked what it serves. Every
 * function in the source must be in the deployment's spec.
 *
 * The earlier check looked for one function's name. That name was already
 * on the deployment from an earlier deploy, so the check passed even when
 * the deploy had gone to the wrong place. Comparing the whole list cannot
 * be satisfied by a stale deployment: a function that was added today is
 * not on the deployment that missed today's deploy.
 *
 * Usage:
 *   node scripts/verify-deployment.mjs [deployment-url]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONVEX_DIR = path.join(ROOT, "convex");

/**
 * The functions a module defines.
 *
 * `export const list = query({...})` and the other two shapes Convex
 * recognises are what a module publishes. A plain `export const` is a
 * helper, not a function, and is not part of the deployment's surface.
 *
 * HTTP routes are left out: they are served as URLs rather than called as
 * functions, and the deployment's spec lists them without an identifier,
 * so there is nothing to compare them by.
 */
const FUNCTION_SHAPES = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(query|mutation|action|internalQuery|internalMutation|internalAction)\s*\(/g;

/** Every function the source defines, as "module.js:name". */
function sourceFunctions() {
    const found = new Set();

    const files = fs
        .readdirSync(CONVEX_DIR, { withFileTypes: true })
        .filter(
            (entry) =>
                entry.isFile() &&
                entry.name.endsWith(".ts") &&
                !entry.name.endsWith(".d.ts") &&
                !entry.name.startsWith("_")
        )
        .map((entry) => entry.name);

    for (const file of files) {
        const source = fs.readFileSync(path.join(CONVEX_DIR, file), "utf8");
        const moduleName = file.replace(/\.ts$/, ".js");
        for (const match of source.matchAll(FUNCTION_SHAPES)) {
            found.add(`${moduleName}:${match[1]}`);
        }
    }

    return found;
}

/** Every function the deployment serves, as "module.js:name". */
function deployedFunctions(url) {
    // The Convex CLI is run through node directly rather than through
    // `npx`: `npx` is a shell script on some systems and a batch file on
    // others, and spawning it without a shell fails on one or the other.
    const cli = path.join(ROOT, "node_modules", "convex", "bin", "main.js");
    if (!fs.existsSync(cli)) {
        throw new Error(`the Convex CLI is not installed at ${cli}`);
    }

    // The CLI's `--url` flag does not choose the deployment for this
    // command — it is silently ignored, and the *configured* deployment is
    // read instead, which is the local one on a developer machine. The
    // flag that works is `--deployment-name`, and the name is the first
    // part of the deployment's URL.
    const args = [cli, "function-spec"];
    const name = deploymentName(url);
    if (name) args.push("--deployment-name", name);

    const raw = execFileSync(process.execPath, args, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
    });

    const spec = JSON.parse(raw);
    const found = new Set();
    for (const fn of spec.functions ?? []) {
        if (fn && typeof fn.identifier === "string") found.add(fn.identifier);
    }
    return { found, url: spec.url };
}

/** The deployment's name, taken from its URL. */
function deploymentName(url) {
    if (!url) return "";
    const match = /^https?:\/\/([^.]+)\./.exec(url);
    return match ? match[1] : "";
}

const target = process.argv[2] ?? process.env.CONVEX_URL ?? "";

let deployed;
try {
    deployed = deployedFunctions(target);
} catch (error) {
    console.error("verify-deployment: could not read the deployment's function spec.");
    console.error(`  ${error.message?.split("\n")[0] ?? error}`);
    process.exit(1);
}

const expected = sourceFunctions();
const missing = [...expected].filter((name) => !deployed.found.has(name)).sort();

console.log("verify-deployment: the deployment against the source");
console.log(`  deployment   : ${deployed.url}`);
console.log(`  functions in the source   : ${expected.size}`);
console.log(`  functions in the deployment: ${deployed.found.size}`);

if (missing.length > 0) {
    console.error(`  MISSING (${missing.length}):`);
    for (const name of missing) console.error(`    ${name}`);
    console.error("");
    console.error("The deployment is NOT serving this commit's code.");
    console.error("The deploy went to a different deployment, or was rolled back.");
    process.exit(1);
}

console.log("  every function in the source is on the deployment.");

#!/usr/bin/env node
/**
 * SMARTBUZ — check that the public routes cannot reach the Convex client.
 *
 * The performance audit (PERF-01) found that the sign-in screen was
 * downloading 227 KB gzipped of JavaScript before the operator had signed
 * in, a quarter of which was the Convex client — pulled in because the
 * providers lived in the root layout.
 *
 * The providers now live on the authenticated routes. This script is the
 * gate that keeps them there: it walks the import graph of the public
 * routes and fails if the Convex client can be reached from any of them.
 *
 *   node scripts/check-public-bundle.mjs
 *
 * It reads the source rather than the built bundle, so it runs in a second
 * and needs no build. The bundle size is measured separately, by
 * `scripts/measure-bundle.mjs`.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The routes a stranger lands on before they have an account.
 *
 * These are the ones that must not carry the Convex client: they read no
 * business data, and they reach the backend through this server instead.
 */
const PUBLIC_ROUTES = [
    "src/app/layout.tsx",
    "src/app/auth/login/page.tsx",
    "src/app/auth/register/page.tsx",
    "src/app/auth/forgot-password/page.tsx",
    "src/app/auth/reset-password/page.tsx",
];

/**
 * The modules that mean the Convex client has been reached.
 *
 * `convex/react` is the client itself. `convex/_generated` is the typed
 * handle on the backend's functions — importing it is how a component asks
 * for data, and it is the thing the public routes must not do.
 */
const FORBIDDEN = ["convex/react", "convex/_generated", "convex/browser"];

/** The source files an import statement may point at. */
const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx"];

const IMPORT_PATTERN =
    /(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every module specifier a file mentions. */
function specifiersIn(source) {
    const found = new Set();
    for (const match of source.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1] ?? match[2];
        if (specifier) found.add(specifier);
    }
    return [...found];
}

/** Resolve an import specifier to a file on disk, or null if it is not ours. */
async function resolveSpecifier(specifier, fromFile) {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;

    const base = specifier.startsWith("@/")
        ? path.join(ROOT, "src", specifier.slice(2))
        : path.resolve(path.dirname(fromFile), specifier);

    for (const extension of RESOLVE_EXTENSIONS) {
        const candidate = `${base}${extension}`;
        try {
            const info = await stat(candidate);
            if (info.isFile()) return candidate;
        } catch {
            // Not this one; try the next.
        }
    }
    return null;
}

/** Every file reachable from the entry points, with the path that reached it. */
async function walk(entries) {
    const seen = new Map(); // file -> the specifier that led to it
    const queue = [];

    for (const entry of entries) {
        const full = path.join(ROOT, entry);
        seen.set(full, "(entry point)");
        queue.push(full);
    }

    while (queue.length > 0) {
        const file = queue.shift();
        const source = await readFile(file, "utf8");

        for (const specifier of specifiersIn(source)) {
            const resolved = await resolveSpecifier(specifier, file);
            if (!resolved) continue;
            if (seen.has(resolved)) continue;
            seen.set(resolved, `${path.relative(ROOT, file)} → ${specifier}`);
            queue.push(resolved);
        }
    }

    return seen;
}

/**
 * The forbidden modules a file reaches.
 *
 * A bare `import "convex/react"` is forbidden outright. A path that *leads*
 * to it — through the file that imports it — is the thing worth reporting,
 * because that file is the one that has to change.
 */
async function forbiddenReached(seen) {
    const hits = [];

    for (const [file] of seen) {
        const source = await readFile(file, "utf8");
        for (const specifier of specifiersIn(source)) {
            if (!FORBIDDEN.some((forbidden) => specifier.startsWith(forbidden))) continue;

            hits.push({
                file: path.relative(ROOT, file),
                specifier,
                reachedVia: seen.get(file),
            });
        }
    }

    return hits;
}

async function main() {
    const entries = [...PUBLIC_ROUTES];
    const seen = await walk(entries);
    const hits = await forbiddenReached(seen);

    console.log(`public routes : ${entries.length}`);
    console.log(`files reachable: ${seen.size}`);
    console.log("");

    if (hits.length === 0) {
        console.log("PASS: no public route can reach the Convex client.");
        return;
    }

    console.log(`FAIL: ${hits.length} public route import(s) reach the Convex client:`);
    for (const hit of hits) {
        console.log(`  ${hit.file}  imports "${hit.specifier}"`);
        console.log(`    reached via ${hit.reachedVia}`);
    }
    process.exitCode = 1;
}

await main();

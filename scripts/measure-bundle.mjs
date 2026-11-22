#!/usr/bin/env node
/**
 * SMARTBUZ — measure what a route actually costs the operator on first load.
 *
 * The performance audit (PERF-01) measured the sign-in route by listing the
 * JavaScript chunks the server put in the HTML and adding up their gzipped
 * sizes. That number — 227 KB — is the one that decides whether a till on a
 * metered connection can start work.
 *
 * This script measures the same thing, the same way, and prints the result
 * per chunk so that the biggest cost can be named rather than guessed at.
 * It talks to a live deployment by default, because that is the number the
 * operator experiences; pass a base URL to measure a different deployment.
 *
 *   node scripts/measure-bundle.mjs
 *   node scripts/measure-bundle.mjs https://smartbuz.vercel.app /auth/login
 *
 * The network from a developer's machine is not always reliable, so a chunk
 * that comes back empty is retried rather than counted as zero bytes.
 */

import http from "node:http";
import https from "node:https";

/**
 * Fetch a URL and report how many bytes came back over the wire.
 *
 * The number that matters is the *compressed* size, because that is what
 * the operator's connection pays for. Node's fetch transparently
 * decompresses the body and then strips the Content-Length and
 * Content-Encoding headers, so the body it hands back is the uncompressed
 * size — the wrong number. The raw request below asks for gzip and simply
 * counts the bytes that arrive, without decompressing anything.
 *
 * A chunk that comes back empty is retried rather than counted as zero
 * bytes: the network from a developer's machine is not always reliable, and
 * a failed fetch is not a small chunk.
 */
function fetchWireSize(url) {
    return new Promise((resolve) => {
        let settled = false;

        const done = (bytes) => {
            if (settled) return;
            settled = true;
            resolve(bytes);
        };

        try {
            const transport = url.startsWith("http://") ? http : https;
            const request = transport.request(
                url,
                {
                    headers: {
                        "Accept-Encoding": "gzip, deflate",
                        "User-Agent": "smartbuz-bundle-measure",
                    },
                    timeout: 30_000,
                },
                (response) => {
                    let bytes = 0;
                    response.on("data", (piece) => {
                        bytes += piece.length;
                    });
                    response.on("end", () => {
                        if (bytes === 0) {
                            done(-1); // Treated as a failed attempt, not a zero-byte chunk.
                            return;
                        }
                        done(bytes);
                    });
                    response.on("error", () => done(-1));
                }
            );

            request.on("timeout", () => request.destroy());
            request.on("error", () => done(-1));
            request.end();
        } catch {
            done(-1);
        }
    });
}

/** Fetch a URL over the wire, retrying until it answers. */
async function wireSize(url, attempts = 4) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const bytes = await fetchWireSize(url);
        if (bytes > 0) return bytes;
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return 0;
}

/** The JavaScript chunks the server referenced in the route's HTML. */
function chunkPaths(html) {
    const paths = new Set();
    const pattern = /\/_next\/static\/chunks\/[^"'\\s]+\.js/g;
    let match;
    while ((match = pattern.exec(html)) !== null) paths.add(match[0]);
    return [...paths].sort();
}

/** Fetch the route's HTML, retrying — the network from a laptop is not always up. */
async function fetchHtml(url, attempts = 5) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
            const html = await response.text();
            if (html.length > 0) return html;
        } catch {
            // Fall through to the retry.
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Could not fetch ${url} after ${attempts} attempts.`);
}

async function main() {
    const base = (process.argv[2] ?? "https://smartbuz.vercel.app").replace(/\/$/, "");
    const route = process.argv[3] ?? "/auth/login";

    const pageUrl = `${base}${route}`;
    const html = await fetchHtml(pageUrl);

    const chunks = chunkPaths(html);
    if (chunks.length === 0) {
        console.error(`No JavaScript chunks found on ${pageUrl}.`);
        process.exitCode = 1;
        return;
    }

    console.log(`Route   : ${route}`);
    console.log(`Base    : ${base}`);
    console.log(`Chunks  : ${chunks.length}`);
    console.log("");

    const rows = [];
    let total = 0;

    for (const chunk of chunks) {
        const bytes = await wireSize(`${base}${chunk}`);
        total += bytes;
        rows.push({ chunk, bytes });
    }

    rows.sort((a, b) => b.bytes - a.bytes);
    for (const { chunk, bytes } of rows) {
        const name = chunk.split("/").pop();
        console.log(`${String(bytes).padStart(8)} B  ${(bytes / 1024).toFixed(1).padStart(7)} KB  ${name}`);
    }

    console.log("");
    console.log(`TOTAL   : ${total} B (${(total / 1024).toFixed(1)} KB gzipped)`);
}

await main();

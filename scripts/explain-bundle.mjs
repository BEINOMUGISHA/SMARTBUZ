#!/usr/bin/env node
/**
 * SMARTBUZ — name what is inside each JavaScript chunk.
 *
 * A bundle is only a number until you know which library the number belongs
 * to. This script reads the chunks of a route and reports, for each one, the
 * libraries whose fingerprints it can find — so "40 KB" becomes "40 KB of
 * Recharts", which is a thing that can be fixed.
 *
 * It is a diagnostic, not a gate: the fingerprints are string matches, so a
 * library that is merely *mentioned* in a chunk will be reported even if it
 * is mostly dead weight. Use it to find candidates, then look.
 *
 *   node scripts/explain-bundle.mjs <chunk-directory>
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The fingerprints worth looking for.
 *
 * Each is a string that appears in the library's own code and rarely
 * anywhere else. `minLength` keeps a library from being reported when only
 * its name is mentioned in a comment.
 */
const SIGNATURES = [
    { library: "react-dom", needles: ["react-dom.production.min.js", "__reactContainer", "ReactDOMRoot"], minLength: 5000 },
    { library: "react", needles: ["react.production.min.js", "useSyncExternalStore"], minLength: 3000 },
    { library: "next-router", needles: ["next/dist/client", "AppRouter"], minLength: 3000 },
    { library: "recharts", needles: ["recharts", "CategoricalChart"], minLength: 5000 },
    { library: "radix-ui", needles: ["radix-ui", "@radix-ui", "data-radix"], minLength: 2000 },
    { library: "lucide-react", needles: ["lucide-react", "lucide"], minLength: 3000 },
    { library: "sonner", needles: ["sonner", "toast"], minLength: 1000 },
    { library: "convex", needles: ["convex", "ConvexReactClient", "convex/browser"], minLength: 3000 },
    { library: "class-variance-authority", needles: ["class-variance-authority", "cva("], minLength: 500 },
    { library: "tailwind-merge", needles: ["tailwind-merge", "twMerge"], minLength: 500 },
    { library: "date-fns", needles: ["date-fns", "differenceInCalendarDays"], minLength: 2000 },
    { library: "zod", needles: ["zod", "ZodError"], minLength: 2000 },
    { library: "pdf-lib", needles: ["pdf-lib", "PDFDocument"], minLength: 3000 },
    { library: "jspdf", needles: ["jsPDF", "jspdf"], minLength: 3000 },
    { library: "html2canvas", needles: ["html2canvas"], minLength: 2000 },
    { library: "dexie", needles: ["dexie", "Dexie"], minLength: 2000 },
    { library: "idb-keyval", needles: ["idb-keyval"], minLength: 1000 },
    { library: "framer-motion", needles: ["framer-motion", "motion"], minLength: 3000 },
];

async function main() {
    const directory = process.argv[2];
    if (!directory) {
        console.error("Usage: node scripts/explain-bundle.mjs <chunk-directory>");
        process.exitCode = 1;
        return;
    }

    const files = (await readdir(directory)).filter((name) => name.endsWith(".js"));
    const rows = [];

    for (const file of files) {
        const full = path.join(directory, file);
        const source = await readFile(full, "utf8");
        const libraries = [];

        for (const signature of SIGNATURES) {
            const hits = signature.needles.filter((needle) => source.includes(needle)).length;
            if (hits > 0) libraries.push(`${signature.library}(${hits})`);
        }

        rows.push({ file, bytes: Buffer.byteLength(source), libraries });
    }

    rows.sort((a, b) => b.bytes - a.bytes);
    for (const row of rows) {
        console.log(
            `${String(row.bytes).padStart(8)} B  ${row.file.padEnd(28)}  ${row.libraries.join(" ") || "—"}`
        );
    }
}

await main();

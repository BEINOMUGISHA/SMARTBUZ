/**
 * SMART_BUZ — how far each language has got.
 *
 *   npm run i18n:check
 *
 * The catalogue of the words the product uses is generated from the code, so
 * this can say exactly which words are still waiting for a translator, and
 * in which file they are read. It fails when a language is incomplete, so a
 * half-finished translation cannot be shipped by accident.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { asWord } from "./i18n-catalogue.mjs";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["src/app", "src/components"];

/**
 * The catalogue files.
 *
 * The vertical catalogue and the package catalogue hold words the reader
 * sees. They are plain `.ts` files, so the walk below does not find them,
 * but they are rendered through `t()` at runtime and must be checked.
 */
const CATALOGUE_FILES = [
    "src/lib/business-categories.ts",
    "src/lib/category-nav.ts",
    ...(fs.existsSync(path.join(ROOT, "convex", "packages", "catalogue"))
        ? fs
              .readdirSync(path.join(ROOT, "convex", "packages", "catalogue"))
              .filter((f) => f.endsWith(".ts"))
              .map((f) => `convex/packages/catalogue/${f}`)
        : []),
];

const CATALOGUE_KEYS = new Set([
    "label",
    "title",
    "description",
    "summary",
    "hint",
    "message",
    "note",
]);

/** The languages the product speaks, and what they call themselves. */
const LOCALES = {
    en: { name: "English" },
    sw: { name: "Swahili" },
    lg: { name: "Luganda" },
    fr: { name: "French" },
};

const CODES = Object.keys(LOCALES);

/** The dictionary, read straight from the file that holds it. */
function readDictionary(code) {
    const file = path.join(ROOT, `src/i18n/dictionaries/${code}.ts`);
    const source = fs.readFileSync(file, "utf8");
    const body = source.match(/= \{([\s\S]*)\n\};/);
    if (!body) return {};

    const entries = {};
    const re = /^\s{4}("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),?\s*$/gm;
    let match;
    while ((match = re.exec(body[1])) !== null) {
        entries[JSON.parse(match[1])] = JSON.parse(match[2]);
    }
    return entries;
}

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (full.endsWith(".tsx")) acc.push(full);
    }
    return acc;
}

/** Every word a reader can see, and where it is read. */
const words = new Map();

/**
 * Add a word to the catalogue, if it is a word.
 *
 * The rule is the one in `i18n-catalogue.mjs`, shared with the codemod that
 * writes the English catalogue, so the two tools always count the same
 * words.
 */
function add(text, where) {
    const word = asWord(text);
    if (!word) return;
    const seen = words.get(word) ?? new Set();
    seen.add(where);
    words.set(word, seen);
}

for (const root of SOURCE_ROOTS) {
    for (const file of walk(path.join(ROOT, root))) {
        const source = ts.createSourceFile(
            file,
            fs.readFileSync(file, "utf8"),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX
        );

        const visit = (node) => {
            if (
                ts.isCallExpression(node) &&
                ts.isIdentifier(node.expression) &&
                (node.expression.text === "t" || node.expression.text === "tr")
            ) {
                const first = node.arguments[0];
                if (first && ts.isStringLiteral(first)) {
                    add(first.text, path.relative(ROOT, file));
                }
            }

            /*
             * A label written in an object — a table column, a tab, a menu
             * item. It is translated where it is shown, so it is part of the
             * catalogue even though the call itself is not a literal.
             */
            if (ts.isPropertyAssignment(node)) {
                const key = node.name.getText(source).replace(/["']/g, "");
                if (
                    [
                        "label",
                        "title",
                        "description",
                        "placeholder",
                        "hint",
                        "message",
                    ].includes(key)
                ) {
                    const init = node.initializer;
                    if (
                        ts.isStringLiteral(init) ||
                        ts.isNoSubstitutionTemplateLiteral(init)
                    ) {
                        add(init.text, path.relative(ROOT, file));
                    }
                }
            }

            ts.forEachChild(node, visit);
        };

        visit(source);
    }
}

/*
 * The catalogue files, read the same way: a property whose value is a word
 * the reader sees. Sample data — the names of the starter products — is the
 * business's own voice and is left out.
 */
for (const rel of CATALOGUE_FILES) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const source = ts.createSourceFile(
        rel,
        fs.readFileSync(full, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );

    const visit = (node, inSample) => {
        let nowInSample = inSample;
        if (ts.isPropertyAssignment(node)) {
            const key = node.name.getText(source).replace(/["']/g, "");
            if (key === "sampleProducts") nowInSample = true;
            if (CATALOGUE_KEYS.has(key) && !nowInSample) {
                const init = node.initializer;
                if (
                    ts.isStringLiteral(init) ||
                    ts.isNoSubstitutionTemplateLiteral(init)
                ) {
                    add(init.text, rel);
                }
            }
            if (!nowInSample) {
                if (key === "name" && ts.isStringLiteral(node.initializer)) {
                    add(node.initializer.text, rel);
                }
                if (
                    key === "terminology" &&
                    ts.isObjectLiteralExpression(node.initializer)
                ) {
                    for (const prop of node.initializer.properties) {
                        if (
                            ts.isPropertyAssignment(prop) &&
                            ts.isStringLiteral(prop.initializer)
                        ) {
                            add(prop.initializer.text, rel);
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, nowInSample));
    };

    visit(source, false);
}

/*
 * The English catalogue is the master list — it is generated from the code,
 * so it knows every word the product uses. The scan above finds the words in
 * the screens; the catalogue also knows the words that live in the tables,
 * the labels and the placeholders the scan does not walk. The truth is the
 * two together, so the check is made against both.
 */
const english = readDictionary("en");
for (const word of Object.keys(english)) {
    if (!words.has(word)) words.set(word, new Set(["src/i18n/dictionaries/en.ts"]));
}

const catalogue = [...words.keys()].sort((a, b) => a.localeCompare(b, "en"));
console.log(`The product uses ${catalogue.length} words.\n`);
let complete = true;

for (const code of CODES) {
    if (code === "en") continue;

    const dictionary = readDictionary(code);
    const missing = catalogue.filter((word) => !dictionary[word]);

    const percent = ((catalogue.length - missing.length) / catalogue.length) * 100;
    console.log(
        `${LOCALES[code].name.padEnd(10)} ${String(
            catalogue.length - missing.length
        ).padStart(4)} / ${catalogue.length}  (${percent.toFixed(1)}%)`
    );

    if (missing.length) {
        complete = false;
        console.log(`  ${missing.length} word(s) still to translate:`);
        for (const word of missing.slice(0, 30)) {
            const where = [...(words.get(word) ?? [])][0] ?? "";
            console.log(`    ${JSON.stringify(word)}  —  ${where}`);
        }
        if (missing.length > 30) {
            console.log(`    … and ${missing.length - 30} more`);
        }
    }
    console.log("");
}

if (!complete) {
    console.log(
        "A language is not finished. Every word above still needs a translation\nbefore the product can be called translated in that language."
    );
    process.exitCode = 1;
} else {
    console.log("Every language is complete.");
}

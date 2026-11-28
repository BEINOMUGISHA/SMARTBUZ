/**
 * SMART_BUZ — put every word the reader sees through the translator.
 *
 *   node scripts/i18n-codemod.mjs [--dry]
 *
 * The product speaks four languages, and the words were written straight into
 * the markup: two thousand six hundred and fifty of them, spread over a
 * hundred and eighty files. This walks every screen with the TypeScript
 * compiler and rewrites the words that a reader can see, so they go through
 * `t()` and can be translated.
 *
 * What it rewrites:
 *
 *   - text in the markup            <p>Save</p>        →  <p>{t("Save")}</p>
 *   - a label on a component         label="Status"     →  label={t("Status")}
 *   - a label read off an object     {row.label}        →  {t(row.label)}
 *   - a message in a toast           toast("Saved")     →  toast(t("Saved"))
 *   - a sentence with a value in it   `Hi ${name}`       →  t("Hi {0}", { 0: name })
 *
 * It leaves alone anything that is not a word: a route, a class name, a
 * currency code, a key in a record.
 *
 * The words are keyed by their English, which is what makes the translation
 * possible at all — and what lets the checker say, exactly, which words are
 * still waiting for a translator.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

import { asWord } from "./i18n-catalogue.mjs";

const DRY = process.argv.includes("--dry");

/** Props whose value is a word the reader sees. */
const TEXT_PROPS = new Set([
    "title",
    "label",
    "placeholder",
    "description",
    "hint",
    "emptyTitle",
    "emptyHint",
    "message",
    "aria-label",
    "alt",
    "tooltip",
    "confirmLabel",
    "cancelLabel",
    "actionLabel",
    "header",
    "caption",
    "emptyMessage",
    "errorMessage",
    "successMessage",
    "confirmText",
    "loadingText",
    "subheading",
    "subtitle",
    "unit",
    "reason",
    "note",
]);

/**
 * Attributes that carry something the machine reads, not a word the reader
 * sees. A CSS class list, a DOM id, a React key and a `value` used for
 * filtering must be identical in every language, so they are never wrapped
 * in `t()`.
 */
const NON_TEXT_PROPS = new Set([
    "className",
    "id",
    "htmlFor",
    "key",
    "value",
    "name",
    "href",
    "src",
    "type",
    "data-testid",
    "style",
]);

/** Properties of an object that hold a word the reader sees. */
const TEXT_KEYS = new Set([
    "label",
    "title",
    "description",
    "placeholder",
    "hint",
    "message",
    "emptyTitle",
    "emptyHint",
    "tooltip",
    "header",
    "caption",
    "reason",
    "note",
    "summary",
    "eyebrow",
    "group",
    "action",
    "confirmLabel",
    "cancelLabel",
    "subheading",
    "subtitle",
]);

/** The functions that put a word in front of the reader. */
const MESSAGE_FUNCTIONS = new Set([
    "toast",
    "toastError",
    "toastSuccess",
    "toastInfo",
    "toastWarning",
    "toastMessage",
    "alert",
    "confirm",
    "notify",
    "showToast",
]);

const ROOT = process.cwd();
const SOURCE_ROOTS = ["src/app", "src/components"];

/* ────────────────────────────────────────────────────────────────────────
 * Collecting
 * ──────────────────────────────────────────────────────────────────────── */

const catalogue = new Map(); // English text → occurrences

/*
 * What counts as a word is decided in one place, in `i18n-catalogue.mjs`, so
 * the checker and this codemod can never disagree about what has to be
 * translated.
 */
function collect(text) {
    const trimmed = asWord(text);
    if (!trimmed) return null;

    catalogue.set(trimmed, (catalogue.get(trimmed) ?? 0) + 1);
    return trimmed;
}

/* ────────────────────────────────────────────────────────────────────────
 * Walking the files
 * ──────────────────────────────────────────────────────────────────────── */

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (full.endsWith(".tsx")) acc.push(full);
    }
    return acc;
}

const files = SOURCE_ROOTS.flatMap((root) => walk(path.join(ROOT, root)));

/*
 * The catalogue files.
 *
 * The vertical catalogue and the package catalogue hold words the reader
 * sees — the name of a business type, what it does, what a package brings.
 * They live in plain `.ts` files, so the walk above does not find them, but
 * they are rendered through `t()` at runtime and must be in the catalogue.
 *
 * Sample data is not part of the product's voice: the names of the starter
 * products are real-world names, so they are left alone.
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

/** Properties whose value is a word the reader sees. */
const CATALOGUE_KEYS = new Set([
    "label",
    "title",
    "description",
    "summary",
    "hint",
    "message",
    "note",
]);

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
                if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
                    collect(init.text);
                }
            }
            // The name of a business type and the word for its stock.
            if ((key === "name" || key === "terminology") && !nowInSample) {
                if (key === "name" && ts.isStringLiteral(node.initializer)) {
                    collect(node.initializer.text);
                }
                if (key === "terminology" && ts.isObjectLiteralExpression(node.initializer)) {
                    for (const prop of node.initializer.properties) {
                        if (
                            ts.isPropertyAssignment(prop) &&
                            ts.isStringLiteral(prop.initializer)
                        ) {
                            collect(prop.initializer.text);
                        }
                    }
                }
            }
        }
        ts.forEachChild(node, (child) => visit(child, nowInSample));
    };

    visit(source, false);
}

/* ────────────────────────────────────────────────────────────────────────
 * The rewrite
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Is this function a React component?
 *
 * A component is a function with a name that begins with a capital letter —
 * the convention React itself relies on. A callback inside a render, such as
 * a `map` over a list, is not a component: a hook cannot be called in it,
 * and the words inside it are translated by the component around it.
 */
function isComponent(node) {
    if (ts.isFunctionDeclaration(node)) {
        return !!node.name && /^[A-Z]/.test(node.name.text);
    }

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
        const parent = node.parent;
        if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            return /^[A-Z]/.test(parent.name.text);
        }
        return false;
    }

    return false;
}

function enclosingComponent(node) {
    let current = node.parent;
    while (current) {
        if (
            (ts.isFunctionDeclaration(current) ||
                ts.isFunctionExpression(current) ||
                ts.isArrowFunction(current)) &&
            isComponent(current)
        ) {
            return current;
        }
        current = current.parent;
    }
    return null;
}

/** Does this function already declare the translator? */
function declaresTranslator(node) {
    let found = false;
    const visit = (child) => {
        if (found) return;
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) {
            if (child.name.text === "t" && child.initializer) {
                const text = child.initializer.getText();
                if (text.includes("useT(")) found = true;
            }
        }
        ts.forEachChild(child, visit);
    };
    visit(node.body);
    return found;
}

/** Does this function bind the name `t` to something of its own? */
function bindsTranslatorName(node) {
    let found = false;
    const visit = (child) => {
        if (found) return;
        if (ts.isParameter(child) && ts.isIdentifier(child.name) && child.name.text === "t") {
            found = true;
            return;
        }
        if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name)) {
            if (child.name.text === "t") found = true;
        }
        ts.forEachChild(child, visit);
    };
    visit(node.body);
    return found;
}

/**
 * The name the translator takes inside this component.
 *
 * A component that already uses `t` for something of its own — a map
 * callback's argument, most often — gets the translator under a different
 * name, so the two never collide.
 */
const translatorNames = new Map();

function translatorName(component) {
    const cached = translatorNames.get(component);
    if (cached) return cached;

    let name = "t";
    if (!declaresTranslator(component) && bindsTranslatorName(component)) {
        name = "tr";
    }
    translatorNames.set(component, name);
    return name;
}

const edits = []; // { start, end, text }

/**
 * The English in a template literal, with the values it holds.
 *
 * `Total ${amount} paid` becomes the key `Total {0} paid` and the values
 * `{ 0: amount }`, so a translator can move the word around.
 */
function templateKey(node, eol) {
    const text = node.getText();
    const parts = [];
    let index = 0;

    // Walk the head and each span/tail.
    const head = node.head.text;
    parts.push(head.replace(/\{/g, "{{").replace(/\}/g, "}}"));
    for (const span of node.templateSpans) {
        parts.push(`{${index}}`);
        index += 1;
        parts.push(span.literal.text.replace(/\{/g, "{{").replace(/\}/g, "}}"));
    }

    const key = parts.join("").replace(/\s+/g, " ").trim();
    if (!key || !/[A-Za-z]/.test(key)) return null;

    const values = node.templateSpans.map(
        (span, i) => `            ${i}: ${span.expression.getText()},`
    );

    return {
        key,
        params: values.length
            ? `, {${eol}${values.join(eol)}${eol}        }`
            : "",
    };
}

function processFile(file) {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );

    const fileEdits = [];
    const componentsNeedingT = new Set();

    // The file keeps the line endings it came with.
    const eol = text.includes("\r\n") ? "\r\n" : "\n";

    const visit = (node) => {
        /* A word already going through the translator. */
        if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            (node.expression.text === "t" || node.expression.text === "tr")
        ) {
            const first = node.arguments[0];
            if (first && ts.isStringLiteral(first)) collect(first.text);
        }

        /* A label in an object — a table column, a menu item, a tab. */
        if (ts.isPropertyAssignment(node)) {
            const key = node.name.getText(source).replace(/["']/g, "");
            if (TEXT_KEYS.has(key)) {
                const init = node.initializer;
                if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
                    /*
                     * The label is collected for the dictionary, but not
                     * written here: an object built at the top of a file is
                     * made before the language is known, and one built inside
                     * a screen is shown by a component that translates it
                     * where it is shown. Either way the reader sees the
                     * right language.
                     */
                    collect(init.text);
                }
            }
        }

        /* Text in the markup. */
        if (ts.isJsxText(node)) {
            const raw = node.getText();
            if (raw.trim()) {
                const leading = raw.slice(0, raw.length - raw.trimStart().length);
                const trailing = raw.slice(raw.trimEnd().length);
                const trimmed = collect(raw.trim());
                if (trimmed) {
                    const component = enclosingComponent(node);
                    if (component) {
                        const name = translatorName(component);
                        componentsNeedingT.add(component);
                        fileEdits.push({
                            start: node.getStart(source) + leading.length,
                            end: node.getEnd(source) - trailing.length,
                            text: `{${name}(${JSON.stringify(trimmed)})}`,
                        });
                    }
                }
            }
        }

        /* A label on a component. */
        if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
            const attrName = node.name.getText(source);
            if (TEXT_PROPS.has(attrName)) {
                const trimmed = collect(node.initializer.text);
                if (trimmed) {
                    const component = enclosingComponent(node);
                    if (component) {
                        const name = translatorName(component);
                        componentsNeedingT.add(component);
                        fileEdits.push({
                            start: node.initializer.getStart(source),
                            end: node.initializer.getEnd(source),
                            text: `{${name}(${JSON.stringify(trimmed)})}`,
                        });
                    }
                }
            }
        }

        /* A label read off an object. */
        if (ts.isJsxExpression(node) && node.expression && ts.isPropertyAccessExpression(node.expression)) {
            const property = node.expression.name.text;
            // A key is an identity, not a word — it must stay the same in
            // every language.
            const isKey =
                node.parent &&
                ts.isJsxAttribute(node.parent) &&
                node.parent.name.getText(source) === "key";
            if (TEXT_KEYS.has(property) && !isKey) {
                const component = enclosingComponent(node);
                if (component) {
                    const name = translatorName(component);
                    componentsNeedingT.add(component);
                    fileEdits.push({
                        start: node.expression.getStart(source),
                        end: node.expression.getEnd(source),
                        text: `${name}(${node.expression.getText(source)})`,
                    });
                }
            }
        }

        /* A message in a toast. */
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && MESSAGE_FUNCTIONS.has(node.expression.text)) {
            const component = enclosingComponent(node);
            if (component) {
                const name = translatorName(component);
                for (const arg of node.arguments) {
                    if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
                        const trimmed = collect(arg.text);
                        if (trimmed) {
                            componentsNeedingT.add(component);
                            fileEdits.push({
                                start: arg.getStart(source),
                                end: arg.getEnd(source),
                                text: `${name}(${JSON.stringify(trimmed)})`,
                            });
                        }
                    } else if (ts.isTemplateExpression(arg)) {
                        const made = templateKey(arg, eol);
                        if (made) {
                            componentsNeedingT.add(component);
                            fileEdits.push({
                                start: arg.getStart(source),
                                end: arg.getEnd(source),
                                text: `${name}(${JSON.stringify(made.key)}${made.params})`,
                            });
                        }
                    }
                }
            }
        }

        /* A sentence with a value in it, written in the markup. */
        if (ts.isJsxExpression(node) && node.expression && ts.isTemplateExpression(node.expression)) {
            /*
             * A template inside a className, an id, a key or a value is not a
             * sentence — it is an identifier or a style. It must read the same
             * in every language, so it is left exactly as it is.
             */
            const attrParent = node.parent;
            const attrName =
                attrParent && ts.isJsxAttribute(attrParent)
                    ? attrParent.name.getText(source)
                    : "";
            if (NON_TEXT_PROPS.has(attrName)) {
                ts.forEachChild(node, visit);
                return;
            }

            const made = templateKey(node.expression, eol);
            if (made) {
                const component = enclosingComponent(node);
                if (component) {
                    const name = translatorName(component);
                    componentsNeedingT.add(component);
                    fileEdits.push({
                        start: node.expression.getStart(source),
                        end: node.expression.getEnd(source),
                        text: `${name}(${JSON.stringify(made.key)}${made.params})`,
                    });
                }
            }
        }

        ts.forEachChild(node, visit);
    };

    visit(source);

    if (fileEdits.length === 0 && componentsNeedingT.size === 0) return false;

    /*
     * Phase one — the words.
     *
     * The edits are applied from the back, so that the position of an edit
     * is still true when it is made.
     */
    fileEdits.sort((a, b) => b.start - a.start);

    let out = text;
    for (const edit of fileEdits) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }

    /*
     * Phase two — the translator.
     *
     * The file is read again, because writing the translator into a
     * component moves everything after it, and the words above were written
     * to the positions they had before.
     */
    out = addTranslators(out, file, eol);

    if (!DRY && out !== text) {
        fs.writeFileSync(file, out);
    }
    return out !== text;
}

/**
 * Give every component that uses the translator its own copy of it.
 *
 * A component that already uses the name `t` for something of its own — a
 * map callback's argument, most often — is given the translator under
 * another name, so the two never collide.
 */
function addTranslators(text, file, eol) {
    const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX
    );

    const edits = [];
    let needsImport = false;

    const visit = (node) => {
        if (
            (ts.isFunctionDeclaration(node) ||
                ts.isFunctionExpression(node) ||
                ts.isArrowFunction(node)) &&
            isComponent(node)
        ) {
            const name = translatorUsedIn(node);
            if (name && !declaresTranslatorNamed(node, name)) {
                const body = node.body;
                if (body && ts.isBlock(body)) {
                    const statement = body.statements[0];
                    const at = statement
                        ? statement.getStart(source)
                        : body.getEnd(source) - 1;
                    edits.push({
                        start: at,
                        end: at,
                        text: `${eol}    const ${name} = useT();`,
                    });
                    needsImport = true;
                } else if (body) {
                    // An arrow with an expression body: give it a block to
                    // hold the hook.
                    edits.push({
                        start: body.getStart(source),
                        end: body.getEnd(source),
                        text: `{${eol}    const ${name} = useT();${eol}    return (${eol}${body.getText(source)}${eol}    );${eol}}`,
                    });
                    needsImport = true;
                }
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(source);

    if (!edits.length && !needsImport) return text;

    edits.sort((a, b) => b.start - a.start);
    let out = text;
    for (const edit of edits) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }

    if (needsImport && !/import\s+\{\s*useT\s*\}\s+from\s+"@\/i18n\/provider";/.test(out)) {
        const importLine = `import { useT } from "@/i18n/provider";`;

        // After the last import, so the file's import block stays together.
        const importRe = /^import[^\n]*?;$/gm;
        const imports = [...out.matchAll(importRe)];
        if (imports.length > 0) {
            const last = imports[imports.length - 1];
            const at = last.index + last[0].length;
            out = out.slice(0, at) + `${eol}${importLine}` + out.slice(at);
        } else {
            out = `${importLine}${eol}${out}`;
        }
    }

    // A hook needs a client component.
    if (
        needsImport &&
        !out.startsWith('"use client"') &&
        !/export const metadata\b/.test(out)
    ) {
        out = `"use client";${eol}${eol}${out}`;
    }

    return out;
}

/**
 * The name the translator has inside this component.
 *
 * It is worked out from the calls that are already in the file, so the
 * declaration and the calls always agree.
 */
function translatorUsedIn(node) {
    let used = null;

    const visit = (child) => {
        if (used) return;
        if (
            ts.isCallExpression(child) &&
            ts.isIdentifier(child.expression) &&
            (child.expression.text === "t" || child.expression.text === "tr")
        ) {
            used = child.expression.text;
            return;
        }
        ts.forEachChild(child, visit);
    };

    visit(node.body);
    return used;
}

/** Does this function already declare the translator under this name? */
function declaresTranslatorNamed(node, name) {
    let found = false;
    const visit = (child) => {
        if (found) return;
        if (
            ts.isVariableDeclaration(child) &&
            ts.isIdentifier(child.name) &&
            child.name.text === name &&
            child.initializer &&
            child.initializer.getText().includes("useT(")
        ) {
            found = true;
        }
        ts.forEachChild(child, visit);
    };
    visit(node.body);
    return found;
}

/* ────────────────────────────────────────────────────────────────────────
 * The run
 * ──────────────────────────────────────────────────────────────────────── */

let changed = 0;
for (const file of files) {
    if (processFile(file)) changed += 1;
}

/* The catalogue, in a stable order. */
const keys = [...catalogue.keys()].sort((a, b) => a.localeCompare(b, "en"));

const catalogueFile = path.join(ROOT, "src/i18n/dictionaries/en.ts");
const catalogueBody = keys
    .map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(key)},`)
    .join("\n");

const catalogueSource = `/**
 * SMART_BUZ — the English words.
 *
 * English is the language the product is written in, so this file is the
 * list of every word a reader can see. Every other language is written
 * against this list: the key is the English, the value is the translation.
 *
 * This file is generated by \`npm run i18n:codemod\` — it is the catalogue,
 * not a hand-written list, so it cannot drift away from the interface.
 *
 * Do not edit it by hand. Run the codemod.
 */

/** Every word the product uses, keyed by itself. */
export const en: Record<string, string> = {
${catalogueBody}
};

/** How many words there are. */
export const EN_COUNT = ${keys.length};
`;

if (!DRY) {
    fs.mkdirSync(path.dirname(catalogueFile), { recursive: true });
    fs.writeFileSync(catalogueFile, catalogueSource);
}

console.log(`files rewritten: ${changed} of ${files.length}`);
console.log(`words in the catalogue: ${keys.length}`);
console.log(`occurrences: ${[...catalogue.values()].reduce((a, b) => a + b, 0)}`);

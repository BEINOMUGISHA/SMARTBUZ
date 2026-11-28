/**
 * i18n-unwind — undo the codemod's wrapping of things that are not words.
 *
 * The codemod wrapped CSS class lists, DOM ids, React keys and filter values
 * in `t()`. Those are read by the machine, not by the reader, and must be
 * byte-identical in every language. This script turns them back into the
 * plain template literal they were before.
 *
 *   className={t("mt-0.5 text-xs font-bold {0}", { 0: x })}
 *      →  className={`mt-0.5 text-xs font-bold ${x}`}
 *
 *   id={t("enabled-{0}", { 0: k })}
 *      →  id={`enabled-${k}`}
 *
 *   value={t("product-{0}-{1}", { 0: a, 1: b })}
 *      →  value={`product-${a}-${b}`}
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

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

function walk(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f, acc);
        else if (f.endsWith(".tsx")) acc.push(f);
    }
    return acc;
}

/** The text of an expression, exactly as it was written. */
function exprText(node, source) {
    return node.getText(source);
}

/**
 * Build a template literal from a key and its parameters.
 * `{0}` in the key becomes `${<value>}` in the literal.
 */
function toTemplate(key, params, source) {
    let out = "`";
    let index = 0;
    const re = /\{(\w+)\}/g;
    let match;
    while ((match = re.exec(key)) !== null) {
        out += key.slice(index, match.index).replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
        const value = params.get(match[1]);
        out += value === undefined ? "${undefined}" : `\${${value}}`;
        index = match.index + match[0].length;
    }
    out += key.slice(index).replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    out += "`";
    return out;
}

let totalEdits = 0;
let totalFiles = 0;

for (const root of ["src/app", "src/components", "src/context", "src/hooks"]) {
    const dir = path.join(ROOT, root);
    if (!fs.existsSync(dir)) continue;

    for (const file of walk(dir)) {
        const text = fs.readFileSync(file, "utf8");
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

        const edits = [];

        const visit = (node) => {
            if (
                ts.isJsxExpression(node) &&
                node.expression &&
                ts.isCallExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                (node.expression.expression.text === "t" ||
                    node.expression.expression.text === "tr")
            ) {
                const attrParent = node.parent;
                if (attrParent && ts.isJsxAttribute(attrParent)) {
                    const attrName = attrParent.name.getText(source);
                    if (NON_TEXT_PROPS.has(attrName)) {
                        const args = node.expression.arguments;
                        const first = args[0];

                        if (first && ts.isStringLiteral(first) && args[1] && ts.isObjectLiteralExpression(args[1])) {
                            // Collect the parameters by name.
                            const params = new Map();
                            for (const prop of args[1].properties) {
                                if (!ts.isPropertyAssignment(prop)) continue;
                                const name = prop.name.getText(source).replace(/["']/g, "");
                                params.set(name, exprText(prop.initializer, source));
                            }
                            edits.push({
                                start: node.expression.getStart(source),
                                end: node.expression.getEnd(),
                                text: toTemplate(first.text, params, source),
                            });
                        } else if (first && ts.isStringLiteral(first) && !args[1]) {
                            // A bare word in a machine-read attribute: put it back as a plain literal.
                            edits.push({
                                start: node.expression.getStart(source),
                                end: node.expression.getEnd(),
                                text: JSON.stringify(first.text),
                            });
                        } else if (first && !ts.isStringLiteral(first)) {
                            // t(someVariable) in a machine-read attribute: unwrap it.
                            edits.push({
                                start: node.expression.getStart(source),
                                end: node.expression.getEnd(),
                                text: exprText(first, source),
                            });
                        }
                    }
                }
            }
            ts.forEachChild(node, visit);
        };

        visit(source);

        if (edits.length === 0) continue;

        edits.sort((a, b) => b.start - a.start);
        let out = text;
        for (const edit of edits) {
            out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
        }

        fs.writeFileSync(file, out, "utf8");
        totalEdits += edits.length;
        totalFiles += 1;
        console.log(`unwound ${edits.length} in ${path.relative(ROOT, file)}`);
    }
}

console.log(`\n${totalEdits} call(s) unwound across ${totalFiles} file(s).`);

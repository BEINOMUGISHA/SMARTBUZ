/**
 * SMART_BUZ — the translation engine.
 *
 * A dictionary is a flat list of the words the product uses, keyed by the
 * English they are written in. That is deliberate: the key *is* the string
 * in the interface, so a missing translation is a missing line in a file
 * rather than a mystery, and the checker can find every word in the code and
 * say whether it has been translated.
 *
 * The engine understands three things a translator needs:
 *
 *   - `{name}` — a value the sentence needs.
 *   - `{count, plural, one {…} other {…}}` — the same sentence in the two
 *     forms a language uses for one and for many.
 *   - a missing key — which falls back to the English, so a half-finished
 *     translation still shows a usable screen rather than a blank one.
 */

/** A dictionary of translations, keyed by the English text. */
export type Dictionary = Readonly<Record<string, string>>;

/** The values a sentence can be given. */
export type TranslationParams = Readonly<Record<string, string | number>>;

/**
 * Fill in the blanks in a sentence.
 *
 * `{count}` becomes the count. A blank that has no value is left as it is, so
 * a missing value is visible rather than silently empty.
 */
export function interpolate(
    template: string,
    params?: TranslationParams
): string {
    if (!params) return template;

    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined ? match : String(value);
    });
}

/**
 * Choose the plural form and fill in the sentence.
 *
 * English and French have two forms, and so do Kiswahili and Luganda for
 * the counting they do. The rule kept here is the one the languages share:
 * one for exactly one, other for everything else.
 */
function resolvePlurals(template: string, params?: TranslationParams): string {
    const marker = "{count, plural,";
    const start = template.indexOf(marker);
    if (start === -1) return template;

    // Find the end of the plural block by balancing the braces.
    let depth = 0;
    let end = -1;
    for (let i = start + marker.length - 1; i < template.length; i++) {
        const ch = template[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0) {
                end = i;
                break;
            }
        }
    }
    if (end === -1) return template;

    const body = template.slice(start + marker.length, end);
    const branches = parseBranches(body);

    const count = Number(params?.count ?? 0);
    const chosen = count === 1 ? branches.one : branches.other;
    const text = chosen ?? branches.other ?? branches.one ?? "";

    return template.slice(0, start) + text + template.slice(end + 1);
}

/** Split a plural body into its `one {…}` and `other {…}` branches. */
function parseBranches(body: string): {
    one?: string;
    other?: string;
} {
    const branches: { one?: string; other?: string } = {};

    const re = /(one|other)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body))) {
        const name = match[1] as "one" | "other";
        const start = match.index + match[0].length;

        let depth = 1;
        let i = start;
        for (; i < body.length; i++) {
            if (body[i] === "{") depth++;
            else if (body[i] === "}") {
                depth--;
                if (depth === 0) break;
            }
        }
        branches[name] = body.slice(start, i);
        re.lastIndex = i;
    }

    return branches;
}

/**
 * Translate a sentence.
 *
 * The key is the English text. When the dictionary has nothing for it, the
 * English is returned — a screen in a partly translated language is still a
 * screen somebody can work with, and the checker reports what is missing.
 */
export function translate(
    dictionary: Dictionary | undefined,
    key: string,
    params?: TranslationParams
): string {
    const text = dictionary?.[key] ?? key;
    return interpolate(resolvePlurals(text, params), params);
}

/**
 * The words a language has, and the words it has not.
 *
 * The checker uses this to say how far a language has got.
 */
export function coverage(
    dictionary: Dictionary | undefined,
    keys: string[]
): { translated: number; missing: string[]; total: number } {
    const missing = keys.filter((key) => !dictionary?.[key]);
    return {
        translated: keys.length - missing.length,
        missing,
        total: keys.length,
    };
}

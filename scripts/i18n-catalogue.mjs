/**
 * SMART_BUZ — what counts as a word.
 *
 * The catalogue is generated from the code, so the two tools that read it —
 * the codemod that writes `en.ts` and the checker that asks whether a
 * language is finished — have to agree on what a word is. Otherwise one of
 * them believes there is a word the other has never heard of, and the
 * translation is never "complete".
 *
 * A word is something a reader reads. A class name, a route, a slug, an id
 * and a number are not words: they are the machine's business, they read the
 * same in every language, and translating them would only make them harder
 * to search for.
 */

/**
 * Whether a piece of text is a word a reader sees.
 *
 * The rules, and why each one is here:
 *
 *   - it has letters in it, so a number or a symbol is not a word;
 *   - it is not code, a route or a class name;
 *   - a `{0}` in it is a placeholder, not a brace, so a sentence with a
 *     value in it is still a sentence;
 *   - a label that carries a number ("31 to 60 days") is a label, but a
 *     lowercase hyphenated token ("retail-plus") is a slug;
 *   - a single letter is a unit.
 */
export function isWord(text) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return false;
    if (!/[A-Za-z]/.test(trimmed)) return false;

    // Braces and angle brackets mean code — unless the braces are the
    // placeholders a sentence carries.
    if (/[{}<>]/.test(trimmed.replace(/\{\d+\}/g, ""))) return false;

    if (/^(https?:|mailto:|\/|#)/.test(trimmed)) return false;

    // A tailwind class is not a word. A class list is always lower case, so
    // a phrase that starts with a capital is a label, not a class list.
    if (
        !/[A-Z]/.test(trimmed) &&
        /(^|[- ])(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|items|justify|gap|space|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|text|bg|border|rounded|font|shadow|transition|duration|min|max|leading|tracking|opacity|z|top|bottom|left|right|inset)-/.test(
            trimmed
        )
    ) {
        return false;
    }

    // A lowercase hyphenated word is a slug or a key, not a sentence — but a
    // label that carries a number ("31 to 60 days") is a label, not a slug.
    if (
        !/[A-Z]/.test(trimmed) &&
        !/\d/.test(trimmed) &&
        /^[a-z0-9-]+(\s[a-z0-9-]+)*$/.test(trimmed)
    ) {
        return false;
    }

    // A single letter is a unit.
    if (trimmed.length <= 2 && !/[A-Z]/.test(trimmed)) return false;

    return true;
}

/**
 * The word, in the shape the catalogue stores it.
 *
 * Returns null when the text is not a word.
 */
export function asWord(text) {
    const trimmed = text.replace(/\s+/g, " ").trim();
    return isWord(trimmed) ? trimmed : null;
}

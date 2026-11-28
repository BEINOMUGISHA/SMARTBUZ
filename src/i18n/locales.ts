/**
 * SMART_BUZ — the languages the product speaks.
 *
 * Four languages, and every one of them is a first language for somebody
 * using the product: English for the business as it is run from Kampala,
 * Kiswahili for the coast and the towns, Luganda for the home of the
 * product, and French for the businesses across the region that keep their
 * books in French.
 *
 * The locale is a small, boring piece of data on purpose: a code, the
 * language's own name for itself, and the locale the number and date
 * formatting uses. Everything else — the words — lives in the dictionaries.
 */

export const LOCALES = {
    en: {
        code: "en",
        /** The name of the language, in that language. */
        nativeName: "English",
        /** The name of the language, in English. */
        name: "English",
        /** The locale used for numbers, dates and currency. */
        intl: "en-UG",
        direction: "ltr",
    },
    sw: {
        code: "sw",
        nativeName: "Kiswahili",
        name: "Swahili",
        intl: "sw-UG",
        direction: "ltr",
    },
    lg: {
        code: "lg",
        nativeName: "Luganda",
        name: "Luganda",
        intl: "lg-UG",
        direction: "ltr",
    },
    fr: {
        code: "fr",
        nativeName: "Français",
        name: "French",
        intl: "fr-FR",
        direction: "ltr",
    },
} as const;

export type LocaleCode = keyof typeof LOCALES;

/** Every language, in the order they are offered. */
export const LOCALE_CODES = Object.keys(LOCALES) as LocaleCode[];

/** The language the product speaks when nothing has been chosen. */
export const DEFAULT_LOCALE: LocaleCode = "en";

/** Is this a language we speak? */
export function isLocaleCode(value: unknown): value is LocaleCode {
    return typeof value === "string" && value in LOCALES;
}

/**
 * The nearest language we speak.
 *
 * A business whose locale is `sw-KE` gets Kiswahili; one whose locale is
 * `fr-CD` gets French; one whose locale is `ar-EG` gets English, because
 * guessing at a language the product has not been written in would show a
 * person a screen in a language they did not choose.
 */
export function resolveLocale(value: string | undefined | null): LocaleCode {
    if (!value) return DEFAULT_LOCALE;

    const exact = value.trim().toLowerCase();
    if (isLocaleCode(exact)) return exact;

    const language = exact.split(/[-_]/)[0];
    if (isLocaleCode(language)) return language;

    return DEFAULT_LOCALE;
}

/** The locale used for number, date and currency formatting. */
export function intlLocale(locale: LocaleCode): string {
    return LOCALES[locale].intl;
}

/**
 * Where the chosen language is remembered.
 *
 * The cookie is what the server reads, so the page is painted in the right
 * language. It lives here, in a plain module, because the server has to be
 * able to read it — a constant that lives in a client module cannot be read
 * from the server at all.
 */
export const LOCALE_COOKIE = "smartbuz.locale";

/** The same name in the browser's own storage. */
export const LOCALE_STORAGE_KEY = "smartbuz.locale";

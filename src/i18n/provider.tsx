"use client";

/**
 * SMART_BUZ — the language the product speaks.
 *
 * The provider holds the language the person is reading in, hands out the
 * `t` function that turns an English sentence into that language, and keeps
 * the numbers and dates in the same language's conventions.
 *
 * The choice is remembered in the browser, because a person who reads
 * Kiswahili at the counter in the morning should not have to choose it again
 * in the afternoon. A business can also set its own language, and that is
 * what a new person is given until they choose for themselves.
 */

import * as React from "react";

import {
    DEFAULT_LOCALE,
    intlLocale,
    isLocaleCode,
    LOCALES,
    LOCALE_COOKIE,
    LOCALE_STORAGE_KEY,
    resolveLocale,
    type LocaleCode,
} from "./locales";
import { translate, type TranslationParams } from "./translate";
import { en } from "./dictionaries/en";
import { sw } from "./dictionaries/sw";
import { lg } from "./dictionaries/lg";
import { fr } from "./dictionaries/fr";
import type { Dictionary } from "./translate";

/** The dictionaries, by language. */
export const DICTIONARIES: Record<LocaleCode, Dictionary> = {
    en,
    sw,
    lg,
    fr,
};

/**
 * Where the chosen language is remembered.
 *
 * The constants live in `./locales`, a plain module, so the server can read
 * the cookie as well. They are re-exported here because the rest of the app
 * reaches for them through the provider.
 */
export { LOCALE_COOKIE, LOCALE_STORAGE_KEY };

export interface I18nContextValue {
    /** The language in use. */
    locale: LocaleCode;
    /** The dictionary for that language. */
    dictionary: Dictionary;
    /** Change the language. */
    setLocale: (locale: LocaleCode) => void;
    /** Translate a sentence, given the English it is written in. */
    t: (key: string | undefined | null, params?: TranslationParams) => string;
    /** A number, written the way this language writes numbers. */
    formatNumber: (value: number | string, options?: Intl.NumberFormatOptions) => string;
    /** A date, written the way this language writes dates. */
    formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
    /** A date and a time together. */
    formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
    /** An amount of money, in the business's own currency. */
    formatMoney: (
        value: number | string,
        currency?: string | null,
        options?: { decimals?: boolean }
    ) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({
    children,
    locale: initialLocale,
}: {
    children: React.ReactNode;
    /** The language the server painted the page in. */
    locale?: LocaleCode;
}) {
    const [locale, setLocaleState] = React.useState<LocaleCode>(
        initialLocale ?? DEFAULT_LOCALE
    );

    // The language the server gave us is the starting point, not a rule: a
    // person who changes the language keeps that choice until they change
    // it back.
    const applied = React.useRef(false);
    React.useEffect(() => {
        if (applied.current) return;
        applied.current = true;

        if (initialLocale) {
            setLocaleState(initialLocale);
            return;
        }

        try {
            const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
            if (isLocaleCode(stored)) setLocaleState(stored);
        } catch {
            // A browser that will not let us read the storage is a browser
            // that will not let us write it either. The default stands.
        }
    }, [initialLocale]);

    React.useEffect(() => {
        document.documentElement.lang = locale;
        document.documentElement.dir = LOCALES[locale].direction;
    }, [locale]);

    const setLocale = React.useCallback((next: LocaleCode) => {
        setLocaleState(next);
        try {
            window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
            // The cookie is what the server reads, so the next page load is
            // painted in the same language.
            document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
        } catch {
            // Nothing to do — the language still changes for this session.
        }
    }, []);

    const dictionary = DICTIONARIES[locale];

    const value = React.useMemo<I18nContextValue>(() => {
        const intl = intlLocale(locale);

        return {
            locale,
            dictionary,
            setLocale,
            t: (key: string | undefined | null, params?: TranslationParams) =>
                key === undefined || key === null
                    ? ""
                    : translate(dictionary, key, params),
            formatNumber: (input: number | string, options?: Intl.NumberFormatOptions) => {
                const number = Number(input);
                if (!Number.isFinite(number)) return String(input ?? "");
                return number.toLocaleString(intl, options);
            },
            formatDate: (input: Date | string | number, options?: Intl.DateTimeFormatOptions) => {
                const date = input instanceof Date ? input : new Date(input);
                if (Number.isNaN(date.getTime())) return String(input ?? "");
                return date.toLocaleDateString(intl, options);
            },
            formatDateTime: (
                input: Date | string | number,
                options?: Intl.DateTimeFormatOptions
            ) => {
                const date = input instanceof Date ? input : new Date(input);
                if (Number.isNaN(date.getTime())) return String(input ?? "");
                return date.toLocaleString(intl, options);
            },
            formatMoney: (
                amount: number | string,
                currency?: string | null,
                options?: { decimals?: boolean }
            ) => {
                const number = Number(amount ?? 0);
                if (!Number.isFinite(number)) return `${currency ?? "UGX"} 0`;
                const code = (currency ?? "UGX").toUpperCase();
                return `${code} ${number.toLocaleString(intl, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: options?.decimals === false ? 0 : 2,
                })}`;
            },
        };
    }, [locale, dictionary, setLocale]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * The language, the translator and the formatters.
 *
 * This is what every screen uses. It throws if it is used outside the
 * provider, because a screen with no language would quietly show English
 * and the person reading it would never know why.
 */
export function useI18n(): I18nContextValue {
    const context = React.useContext(I18nContext);
    if (!context) {
        throw new Error("useI18n must be used inside the I18nProvider.");
    }
    return context;
}

/**
 * Just the translator.
 *
 * `const t = useT();` reads better at the top of a screen than pulling the
 * whole context out when all the screen wants is to say something.
 */
export function useT(): I18nContextValue["t"] {
    return useI18n().t;
}

/**
 * The language a business should start in.
 *
 * A business whose locale is `sw-KE` opens in Kiswahili. This is used once,
 * when the business record arrives, and only for a person who has not yet
 * chosen a language for themselves.
 */
export function businessLocale(value: string | undefined | null): LocaleCode {
    return resolveLocale(value);
}

/**
 * SMART_BUZ — the translations themselves.
 *
 * The product speaks four languages. This checks that the three translations
 * are the same length as the English, that none of them is empty, and that
 * none of them has picked up a character from another script - a Chinese
 * character in the middle of a Swahili sentence is invisible in a diff but
 * very visible to the person reading the screen.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { en } from "../src/i18n/dictionaries/en";
import { sw } from "../src/i18n/dictionaries/sw";
import { lg } from "../src/i18n/dictionaries/lg";
import { fr } from "../src/i18n/dictionaries/fr";

const LANGUAGES = { sw, lg, fr };

/**
 * What a translation may contain.
 *
 * Latin letters, the accents French uses, the punctuation the product writes
 * with, the flags and the few symbols the interface uses. Anything outside
 * this is a character from another alphabet, and it does not belong in a
 * Swahili, Luganda or French sentence.
 */
const ALLOWED =
    /^[A-Za-z0-9À-ɏŒœŠšŸŽž\s.,:;'"!?()\[\]{}/\\@#$%&*+=<>|~`^_\-\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u00B7\u00B0\u00AB\u00BB\u2192\u2122\u20AC\u2264\u2265\u2318\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}]*$/u;

/** The words that are examples rather than words, and read the same everywhere. */
const EXAMPLE = /^[\d\s@.+\-…/:()]+$/;

describe("the translations", () => {
    it("has the same words in every language", () => {
        const english = Object.keys(en);

        for (const [name, dictionary] of Object.entries(LANGUAGES)) {
            const keys = Object.keys(dictionary);
            assert.equal(
                keys.length,
                english.length,
                `${name} has ${keys.length} words, English has ${english.length}`
            );

            const missing = english.filter((word) => !(word in dictionary));
            assert.deepEqual(
                missing.slice(0, 10),
                [],
                `${name} is missing ${missing.length} word(s)`
            );

            const extra = keys.filter((word) => !(word in en));
            assert.deepEqual(
                extra.slice(0, 10),
                [],
                `${name} has ${extra.length} word(s) the product does not use`
            );
        }
    });

    it("never leaves a word empty", () => {
        for (const [name, dictionary] of Object.entries(LANGUAGES)) {
            const empty = Object.entries(dictionary)
                .filter(([, value]) => value.trim() === "")
                .map(([word]) => word);

            assert.deepEqual(
                empty.slice(0, 10),
                [],
                `${name} has ${empty.length} empty word(s)`
            );
        }
    });

    it("never carries a character from another script", () => {
        for (const [name, dictionary] of Object.entries(LANGUAGES)) {
            const stray = Object.entries(dictionary)
                .filter(([, value]) => !ALLOWED.test(value))
                .map(([word, value]) => `${word} -> ${value}`);

            assert.deepEqual(
                stray.slice(0, 10),
                [],
                `${name} has ${stray.length} word(s) with a character from another script`
            );
        }
    });

    it("keeps the placeholders the English has", () => {
        for (const [name, dictionary] of Object.entries(LANGUAGES)) {
            const broken = Object.entries(en)
                .filter(([word]) => /\{\d+\}/.test(word))
                .filter(([word]) => {
                    const englishSlots = (word.match(/\{\d+\}/g) ?? []).join(",");
                    const translatedSlots =
                        (dictionary[word]?.match(/\{\d+\}/g) ?? []).join(",");
                    return englishSlots !== translatedSlots;
                })
                .map(([word]) => word);

            assert.deepEqual(
                broken.slice(0, 10),
                [],
                `${name} has ${broken.length} word(s) whose placeholders do not match`
            );
        }
    });

    it("keeps the examples that read the same everywhere", () => {
        for (const [name, dictionary] of Object.entries(LANGUAGES)) {
            const changed = Object.entries(en)
                .filter(([word]) => EXAMPLE.test(word))
                .filter(([word]) => dictionary[word] !== word)
                .map(([word]) => word);

            assert.deepEqual(
                changed.slice(0, 10),
                [],
                `${name} changed ${changed.length} example(s) that should not change`
            );
        }
    });
});

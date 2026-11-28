import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Convex's generated code is written by `npx convex codegen`, not by
    // hand. Its own `/* eslint-disable */` banner is reported by ESLint 9
    // as an unused directive, so linting it produced four errors that no
    // human can fix and that would change on every codegen run.
    "convex/_generated/**",
    // Scratch output from the QA audit. Not part of the application.
    ".qa-audit/**",
    // The bundles the test runner writes before handing them to Node. They
    // are generated from the tests on every run, so linting them reports
    // thousands of problems in code nobody wrote and can never fix.
    ".test-build/**",
    // One-off scripts kept while a fix was being made.
    ".scratch/**",
    // The profile and the screenshots a local browser run leaves behind.
    ".tmp-chrome-profile/**",
    ".tmp-shots*/**",
  ]),
]);

export default eslintConfig;

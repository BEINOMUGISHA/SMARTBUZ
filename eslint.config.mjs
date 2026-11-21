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
  ]),
]);

export default eslintConfig;

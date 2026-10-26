// SPDX-License-Identifier: GPL-3.0-or-later

import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "coverage", "test-results*", "playwright-report*"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Untrusted text is only ever rendered as React text.
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: "Render untrusted text as React text.",
        },
        {
          selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
          message: "Render untrusted text as React text.",
        },
      ],
    },
  },
  {
    // The engine and the YAML code run in Node too: nothing from the page.
    files: ["src/engine/**/*.ts", "src/yaml/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "localStorage",
        "sessionStorage",
        "navigator",
        "location",
      ],
    },
  },
  {
    // A classic script served as it is, before the app.
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    files: ["test/**/*.ts", "e2e/**/*.{ts,mjs}", "scripts/**/*.{mjs,ts}", "*.config.ts", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
);

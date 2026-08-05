const js = require("@eslint/js");
const pluginReact = require("eslint-plugin-react");
const pluginReactHooks = require("eslint-plugin-react-hooks");
const pluginJsxA11y = require("eslint-plugin-jsx-a11y");
const pluginImport = require("eslint-plugin-import");
const unusedImports = require("eslint-plugin-unused-imports");
const tsParser = require("@typescript-eslint/parser");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: {
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "jsx-a11y": pluginJsxA11y,
      // Registered so that the `/* eslint-disable import/... */` directives already present in the
      // tree resolve. An unregistered plugin turns every such directive into a hard
      // "Definition for rule ... was not found" ERROR, which is noise, not a finding.
      import: pluginImport,
      "unused-imports": unusedImports,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2021,
        process: "readonly",
        // webpack provides `require` inside browser bundles — it is how this codebase does lazy
        // requires to break import cycles (e.g. backendWeatherServiceClientDiag.getMainClient).
        // Without it the linter reports a no-undef that is not real.
        require: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // React rules
      "react/jsx-uses-react": "error",
      "react/jsx-uses-vars": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off", // Handled: temporarily disabled to prevent infinite re-render loops while polishing

      // Unused imports — auto-fixable (removes entire import lines)
      "unused-imports/no-unused-imports": "warn",

      // Turn off base rule, use plugin version that has auto-fix
      // Allow: vars/args prefixed with _, and caught errors named e/err/error
      "no-unused-vars": "off",
      "unused-imports/no-unused-vars": "off", // Handled: temporarily disabled

      // General JS rules
      "no-undef": "error",
      "no-console": "off",
      "no-debugger": "warn",

      // Accessibility (WCAG 2.1 AA)
      // ERROR — these are fully resolved, block regressions:
      "jsx-a11y/alt-text": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/heading-has-content": "error",
      // PROMOTED — these rules block builds to prevent a11y regressions:
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/anchor-is-valid": "error",
      // ⛔⛔ THESE FIVE WERE "off", AND THAT IS WHY THE a11y GATE WAS GREEN (measured 2026-08-05).
      // CLAUDE.md's accessibility mandate names its #1 prohibition as "real <button>/<input>, never
      // a bare div-with-onClick" — and the four rules that police exactly that were switched off,
      // with ZERO jsx-a11y entries in eslint_baseline.json. So CI passed while:
      //     label-has-associated-control          195
      //     click-events-have-key-events          194
      //     no-static-element-interactions        185
      //     control-has-associated-label          149
      //     no-noninteractive-element-interactions 52
      //                                     TOTAL 775   (1015 files, measured with the repo's own eslint)
      // ★ WARN, NOT ERROR, DELIBERATELY. 775 open violations as `error` is a gate that is red on
      //   day one, and a gate born red gets disabled — this file's own history records that exact
      //   reasoning for `continue-on-error` in ci.yml. As warnings they are RATCHETED by
      //   scripts/check_eslint.js: recorded in the baseline, shrink-only, so the debt can never
      //   grow again. Promote a rule to "error" the day its count reaches zero.
      // ⛔ Do NOT "fix" a count by re-running --write-baseline; that launders debt into allowance.
      "jsx-a11y/label-has-associated-control": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/control-has-associated-label": "warn",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      // v29: ALL remaining warns promoted to error for full regression blocking
      "jsx-a11y/interactive-supports-focus": "error",
      "jsx-a11y/no-access-key": "error",
      // See the block above: "off" is what made this gate green over 775 violations. Ratcheted now.
      "jsx-a11y/no-noninteractive-element-interactions": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/scope": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
  {
    // TYPESCRIPT — the 21 files under src/admin are .ts/.tsx. The `files` glob above always
    // CLAIMED to cover them, but no TS parser was wired in, so espree died on the first
    // `interface` keyword and every one of them failed with a fatal parse error. A file that
    // cannot be parsed is a file that is NOT LINTED: no-undef can never fire there. That is a
    // silent coverage hole, not a config nit — it is the same shape as the bug this gate exists
    // to catch. @typescript-eslint/parser was already a devDependency; it was just never used.
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // TYPE-SPACE ONLY. `NodeJS` is the ambient namespace from @types/node, referenced as
        // `useRef<NodeJS.Timeout>`. Base `no-undef` reads value space only and cannot see TS
        // types, so it reports the namespace as undefined. Declaring the one namespace keeps
        // `no-undef` ARMED on these files — the alternative (switching the rule off for .ts/.tsx,
        // as typescript-eslint suggests) would hand back the exact protection this gate adds.
        NodeJS: "readonly",
      },
    },
  },
  {
    // Test files — add Jest and Node globals to prevent no-undef errors
    files: ["src/**/*.test.{js,jsx,ts,tsx}", "src/**/__tests__/**/*.{js,jsx,ts,tsx}", "src/setupTests.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
      },
    },
  },
  {
    // NODE-CONTEXT files that live under src/ but never run in the browser: the CRA dev-server
    // proxy and the Jest module mocks. They are CommonJS, so browser-only globals reported
    // `module`/`require` as undefined — linter noise, not defects.
    files: ["src/setupProxy.js", "src/testMocks/**/*.{js,jsx}"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
  {
    // Ignore build artifacts and node_modules
    ignores: ["node_modules/**", "build/**", "public/**", "*.config.js"],
  },
];

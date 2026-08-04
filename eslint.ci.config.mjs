/**
 * The blocking gate. `npm run lint:ci` — used identically by CI, the
 * pre-commit hook, and the Claude Code PostToolUse hook.
 *
 * Why this exists separately from eslint.config.js:
 *
 * 1. `--max-warnings 0` has to mean something. The main config carries ~512
 *    deliberate warnings (the i18n string backlog, react-hooks/exhaustive-deps).
 *    Running it with `--max-warnings 0` would make exhaustive-deps blocking,
 *    which is precisely what we decided not to do — a blocking exhaustive-deps
 *    trains humans and agents alike to scatter blanket eslint-disable comments
 *    and gut the gate. This config enables no warn-level rule at all, so
 *    `--max-warnings 0` is both satisfiable and meaningful.
 *
 * 2. A reduced, explicit rule set. Note this is NOT a speed win — measured over
 *    255 files in src, this config takes 44s and the full one 37s, because
 *    set-state-in-render runs the React Compiler and the full config's extra
 *    rules are cheap by comparison. Speed comes from scope, not rule count:
 *    `npm run lint:ci -- <paths>` on a single file is ~2s, which is why the
 *    pre-commit and PostToolUse hooks pass explicit paths instead of re-running
 *    the whole gate on every save.
 *
 * Everything here is IMPORTED from eslint.config.js rather than restated, so
 * the two gates cannot drift. Do not inline copies of the ignore lists or the
 * fence definitions. Note also that CLI `--rule` overrides are buggy under
 * flat config (ESLint #19361, #18459) — a config file is the supported way to
 * express a reduced rule set.
 */
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";
import cfg, { IGNORES, BLOCKING_RULES, oniqPlugin } from "./eslint.config.js";

// The project fences, lifted straight out of the main config so their
// per-directory `files`/`ignores` come along unchanged. Derived, not copied.
const FENCE_BLOCKS = cfg.filter((block) =>
  Object.entries(block.rules ?? {}).some(([id, sev]) => id.startsWith("oniq/") && sev === "error"),
);

export default tseslint.config(
  { ignores: IGNORES },
  {
    files: ["**/*.{ts,tsx}"],
    // tseslint.configs.base wires up the TS parser and plugin without enabling
    // a single rule — exactly what a minimal gate wants.
    extends: [tseslint.configs.base],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    linterOptions: {
      // The codebase carries eslint-disable comments for rules this config
      // does not enable. They are not unused, they are out of scope here.
      reportUnusedDisableDirectives: "off",
    },
    plugins: { "react-hooks": reactHooks, "unused-imports": unusedImports, oniq: oniqPlugin },
    rules: {
      // The rule this whole gate exists for. On 2026-08-04 three violations of
      // it were live in production, having passed a clean tsc, 275 green
      // tests, and a signed-in walk of the app. Hooks-order errors are a known
      // systematic failure mode for LLM-written components, and this codebase
      // is written almost entirely by agents.
      "react-hooks/rules-of-hooks": "error",
      // Infinite render loops.
      "react-hooks/set-state-in-render": "error",
      // Agents generate defensively and leave imports behind. Unambiguous and
      // autofixable, so it is safe to block on. The 15 that existed when this
      // gate was built are frozen in eslint-suppressions.ci.json rather than
      // swept — only NEW ones fail.
      "unused-imports/no-unused-imports": "error",
      ...BLOCKING_RULES,
    },
  },
  ...FENCE_BLOCKS,
);

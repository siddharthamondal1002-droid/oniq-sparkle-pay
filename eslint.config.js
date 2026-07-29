import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // B1 media-URL fence: all NEW code must resolve media via
  // src/lib/media/resolveMedia.ts (short-lived signed URLs). The listed
  // legacy files still sign directly (some with multi-year TTLs stored in
  // rows) — migrating them + their stored URLs is tracked B1 debt.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/media/resolveMedia.ts",
      "src/routes/_authenticated/app.clips.tsx",
      "src/components/customize/CustomizeSheet.tsx",
      "src/routes/_authenticated/app.admin.tsx",
      "src/routes/_authenticated/app.chat.updates.tsx",
      "src/components/moments/MomentsFeed.tsx",
      "src/lib/clipThumbs.ts",
      "src/routes/_authenticated/app.chat.$conversationId.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='createSignedUrl']",
          message: "Sign media through src/lib/media/resolveMedia.ts (TTL-capped, cached), not directly.",
        },
        {
          selector: "CallExpression[callee.property.name='createSignedUrls']",
          message: "Sign media through src/lib/media/resolveMedia.ts (TTL-capped, cached), not directly.",
        },
        {
          selector: "CallExpression[callee.property.name='getPublicUrl']",
          message: "No public media URLs — resolve via src/lib/media/resolveMedia.ts.",
        },
      ],
    },
  },
  eslintPluginPrettier,
);

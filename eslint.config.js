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

  // i18n-1 — no hardcoded currency symbols in source. Every amount goes through
  // src/lib/format.ts (useFormat().money / moneyIn), which drives Intl from
  // CountryConfig.numberLocale + .currency.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/format.ts",
      "src/data/countryRegistry.ts",
      "src/data/appRegistry.ts",            // "₹" is a tile glyph, not an amount
      "src/routes/_authenticated/app.upi.tsx", // frozen: UPI intent internals
      "src/lib/**/__tests__/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXText[value=/[\\u20B9\\u00A3\\u20AC]/]",
          message: "i18n: no hardcoded currency symbol — use useFormat().money() or moneyIn().",
        },
        {
          selector: "Literal[value=/[\\u20B9\\u00A3\\u20AC]/]",
          message: "i18n: no hardcoded currency symbol — use useFormat().money() or moneyIn().",
        },
        {
          selector: "TemplateElement[value.raw=/[\\u20B9\\u00A3\\u20AC]/]",
          message: "i18n: no hardcoded currency symbol — use useFormat().money() or moneyIn().",
        },
        {
          selector: "CallExpression[callee.property.name='toLocaleString']",
          message: "i18n: use src/lib/format.ts (Intl via CountryConfig), not ad-hoc toLocaleString.",
        },
      ],
    },
  },

  // i18n-2 — RTL: physical CSS properties break mirroring for AE (dir: rtl).
  // Tailwind v4 has logical properties natively: ms-/me-/ps-/pe-,
  // text-start/end, border-s/e, start-/end-. The `rtl:` variant is only for
  // transforms (rtl:-scale-x-100). The ignores list is the pre-existing
  // backlog — NEW files must be logical from the start.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/DirectionalToaster.tsx",
      "src/components/chat/CallOverlay.tsx",
      "src/components/chat/IncomingCallScreen.tsx",
      "src/components/earn/InviteNotification.tsx",
      "src/components/home/HomeCountryPrompt.tsx",
      "src/components/landing/LiveNewsSection.tsx",
      "src/components/moments/MomentsFeed.tsx",
      "src/components/reels/ReelTile.tsx",
      "src/components/share/ShareSheet.tsx",
      "src/components/ui/alert.tsx",
      "src/components/ui/calendar.tsx",
      "src/components/ui/carousel.tsx",
      "src/components/ui/command.tsx",
      "src/components/ui/context-menu.tsx",
      "src/components/ui/dialog.tsx",
      "src/components/ui/dropdown-menu.tsx",
      "src/components/ui/hover-card.tsx",
      "src/components/ui/menubar.tsx",
      "src/components/ui/navigation-menu.tsx",
      "src/components/ui/pagination.tsx",
      "src/components/ui/popover.tsx",
      "src/components/ui/resizable.tsx",
      "src/components/ui/select.tsx",
      "src/components/ui/sheet.tsx",
      "src/components/ui/sidebar.tsx",
      "src/components/ui/table.tsx",
      "src/components/ui/tooltip.tsx",
      "src/components/vitals/BreathingCard.tsx",
      "src/routes/_authenticated/app.ai.tsx",
      "src/routes/_authenticated/app.chat.$conversationId.tsx",
      "src/routes/_authenticated/app.chat.index.tsx",
      "src/routes/_authenticated/app.chat.me.tsx",
      "src/routes/_authenticated/app.chat.reels.tsx",
      "src/routes/_authenticated/app.chat.tsx",
      "src/routes/_authenticated/app.chat.updates.tsx",
      "src/routes/_authenticated/app.clips.tsx",
      "src/routes/_authenticated/app.faith.tsx",
      "src/routes/_authenticated/app.food.$id.tsx",
      "src/routes/_authenticated/app.index.tsx",
      "src/routes/_authenticated/app.learn.tsx",
      "src/routes/_authenticated/app.profile.tsx",
      "src/routes/_authenticated/app.rides.tsx",
      "src/routes/_authenticated/app.scan.tsx",
      "src/routes/_authenticated/app.study.tsx",
      "src/routes/_authenticated/app.tsx",
      "src/routes/_authenticated/app.u.$userId.tsx",
      "src/routes/_authenticated/app.upi.tsx",
      "src/routes/_authenticated/app.weather.tsx",
      "src/routes/auth.tsx",
      "src/routes/blog.super-apps-in-india.tsx",
      "src/routes/blog.what-is-a-super-app.tsx",
      "src/routes/child-safety.tsx",
      "src/routes/delete-account.tsx",
      "src/routes/index.tsx",
      "src/routes/privacy.tsx",
      "src/routes/terms.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "JSXAttribute[name.name='className'] Literal[value=/(^|[\\s\"'`])(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)[0-9a-z]/]",
          message: "RTL: use logical properties (ms-/me-/ps-/pe-, start-/end-, text-start/text-end) instead of physical ones.",
        },
        {
          selector:
            "JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|[\\s\"'`])(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)[0-9a-z]/]",
          message: "RTL: use logical properties (ms-/me-/ps-/pe-, start-/end-, text-start/text-end) instead of physical ones.",
        },
      ],
    },
  },

  // i18n-3 — user-facing strings should come from the translation path
  // (useT()/dictionaries.ts, or tileLabel.ts for ONIQ tile names). Warn-only:
  // this is a migration backlog, not a hard gate, and brand names are exempt
  // by design.
  {
    files: ["src/routes/**/*.tsx", "src/components/**/*.tsx"],
    ignores: ["src/components/ui/**"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "JSXText[value=/[A-Za-z]{3,}\\s+[A-Za-z]{3,}\\s+[A-Za-z]{3,}/]",
          message: "i18n: hardcoded user-facing string — move it to dictionaries.ts and render via useT().",
        },
      ],
    },
  },
  eslintPluginPrettier,
);

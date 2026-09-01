import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: [
      "src/**/*.test.ts",
      // Edge-function tests live beside their module. They are NOT under src/
      // on purpose: tsconfig's `include` is `src/**`, so a test there would
      // pull llm.ts into the app typecheck, and llm.ts references Deno globals
      // the browser tsconfig knows nothing about. Deno typechecks that file on
      // deploy; this keeps `tsc --noEmit` honest about the app.
      "supabase/functions/**/__tests__/*.test.ts",
    ],
    environment: "node",
  },
});

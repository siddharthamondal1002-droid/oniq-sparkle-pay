/**
 * The QueryClient must ship sane defaults.
 *
 * On a mobile WebView the app foregrounds/backgrounds constantly. With the
 * stock TanStack Query defaults (staleTime 0, retry 3) the ~76 queries that
 * set no staleTime of their own refetched on every focus and, during an
 * outage, retried three times each with exponential backoff — a self-
 * sustaining request storm measured in the 2026-08-19 audit.
 *
 * These are the floor, not a ceiling: a query that needs tighter freshness
 * still sets its own staleTime and overrides the default. This test only
 * guards that the floor does not silently revert to zero.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src/router.tsx"), "utf8");
// Strip comments so the note above (which quotes the values) can't satisfy the
// assertions on its own.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("QueryClient defaults", () => {
  it("sets a non-zero staleTime so focus/remount does not refetch everything", () => {
    expect(code, "the QueryClient no longer sets defaultOptions").toContain("defaultOptions");
    expect(code, "staleTime default is gone — the focus-refetch storm is back").toMatch(
      /staleTime:\s*30_?000/,
    );
  });

  it("caps retries so an outage does not trigger 3x backoff per query", () => {
    expect(code, "retry default is gone — outages retry-storm again").toMatch(/retry:\s*1\b/);
  });
});

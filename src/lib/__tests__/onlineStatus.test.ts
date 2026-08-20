/**
 * P11 — the online-status store. The test env here is node (no window), which
 * is also the SSR path, so the browser-listener wiring is pinned by source
 * assertion (the repo's convention for browser-only code) while the pure
 * snapshot and the no-window guard are exercised directly.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getOnlineSnapshot, subscribeOnline } from "@/lib/useOnlineStatus";

const src = readFileSync(join(process.cwd(), "src/lib/useOnlineStatus.ts"), "utf8");

describe("online status store", () => {
  it("getOnlineSnapshot reflects navigator.onLine", () => {
    // Restore the ORIGINAL descriptor afterwards (navigator.onLine is normally
    // a prototype getter) so this mutation cannot leak to another test by
    // run-order — that leak was a real flake.
    const own = Object.getOwnPropertyDescriptor(navigator, "onLine");
    try {
      Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
      expect(getOnlineSnapshot()).toBe(false);
      Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
      expect(getOnlineSnapshot()).toBe(true);
    } finally {
      if (own) Object.defineProperty(navigator, "onLine", own);
      else delete (navigator as { onLine?: boolean }).onLine;
    }
  });

  it("defaults to online when navigator is unavailable (never traps the UI offline)", () => {
    // The source must fall back to true rather than false when the API is gone.
    expect(src).toMatch(/typeof navigator === "undefined" \? true : navigator\.onLine/);
  });

  it("subscribeOnline is a safe no-op with no window (SSR path)", () => {
    // In this node env window is undefined — the SSR branch returns a cleanup
    // function that does nothing and never throws.
    const unsub = subscribeOnline(() => {});
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
  });

  it("registers BOTH online and offline and removes BOTH on cleanup", () => {
    // Structural: a leaked listener per mount is the failure this guards.
    expect(src).toMatch(/addEventListener\("online", callback\)/);
    expect(src).toMatch(/addEventListener\("offline", callback\)/);
    expect(src).toMatch(/removeEventListener\("online", callback\)/);
    expect(src).toMatch(/removeEventListener\("offline", callback\)/);
  });
});

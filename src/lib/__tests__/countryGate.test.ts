/**
 * FOUR FEATURES RIDE ON country_code, SO NOT ASKING IS EXPENSIVE.
 *
 * Reported 2026-08-17 as "watch is not visible to old users". Measured on
 * production the same hour: 96 of 107 accounts have no country_code, 91 of
 * them older than a week.
 *
 * isAvailable() returns false whenever the user's country is not in a
 * feature's list, and null is in no list. study, earn, upi and watch are all
 * gated to ["IN"], so those 96 accounts cannot see any of the four. That is
 * nine users in ten, missing a quarter of the app, with nothing on screen to
 * say so.
 *
 * The prompt that collects the country was dismissible with a PERMANENT
 * localStorage flag — one tap and the app never asked again. These guards
 * keep the dismissal a pause rather than a door that locks behind you.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAvailable } from "@/data/countryRegistry";

const ROOT = process.cwd();
const PROMPT = readFileSync(join(ROOT, "src/components/home/HomeCountryPrompt.tsx"), "utf8");
const REGISTRY = readFileSync(join(ROOT, "src/data/countryRegistry.ts"), "utf8");

describe("an unset country hides real features, so the ask must come back", () => {
  it("the gate genuinely fails closed on a missing country", () => {
    // Not a hypothetical. This is the exact call the home screen makes, and
    // it is why 96 accounts see no Watch tile.
    for (const feature of ["watch", "study", "earn", "upi"]) {
      expect(
        isAvailable(feature, null as unknown as never),
        `${feature} is no longer hidden by a null country — the premise of this file changed`,
      ).toBe(false);
    }
  });

  it("all four India-gated features are still the ones at stake", () => {
    // If a fifth joins the list the cost of not asking goes up, and whoever
    // adds it should see this test and know that.
    const gated = [...REGISTRY.matchAll(/\{ id: "([a-z]+)", supportedCountries: \["IN"\] \}/g)].map(
      (m) => m[1],
    );
    expect(gated.sort()).toEqual(["earn", "study", "upi", "watch"]);
  });

  it("the dismissal expires instead of lasting forever", () => {
    expect(PROMPT, "the dismissal has no expiry window").toContain("DISMISS_DAYS");
    expect(PROMPT).toContain("dismissedRecently()");
    // A permanent flag is exactly what stranded those 91 accounts.
    expect(
      PROMPT,
      'the permanent "1" dismissal flag is back',
    ).not.toContain('localStorage.setItem(DISMISS_KEY, "1")');
  });

  it("treats the legacy permanent flag as owed another ask", () => {
    // The accounts holding "1" ARE the stranded ones. Reading that value as a
    // fresh dismissal would fix the bug for nobody who currently has it.
    const fn = PROMPT.slice(PROMPT.indexOf("function dismissedRecently"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body, "the legacy flag is not handled").toContain('raw === "1"');
    expect(body, "the legacy flag must NOT count as recently dismissed").toMatch(
      /raw === "1"\)\s*return false/,
    );
  });
});

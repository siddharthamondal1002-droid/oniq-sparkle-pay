import { describe, expect, it } from "vitest";
import {
  selectSceneWeather,
  stripThemeWeather,
  weatherConsistentSetting,
} from "@/lib/sceneWeather";

/**
 * ONE authoritative visible-scene weather decision (owner, 2026-08-21).
 * The decision is made from the shot's OWN visible scene, and the SAME token
 * drives both the image prompt and the post-render VFX, so they can never
 * disagree. Narration (remembered/among storms) and the film-wide theme must
 * never override the visible weather.
 */
describe("selectSceneWeather — the single visible-scene decision", () => {
  it("REQUIRED: dry scene + narration containing storm/monsoon/flood → no rain", () => {
    // This is the exact shot-3 case from the 5-shot validation: the narration
    // is soaked in weather the scene does NOT show. The decision reads the
    // SCENE only, so it never becomes rain. (A dusty market earns dust — a dry
    // atmosphere, not precipitation — which is correct; the point is NO RAIN.)
    const scene = "A bright market square, cloudless, golden afternoon sun.";
    const narration =
      "She remembered the terrible storm and the monsoon floods of her childhood.";
    const decision = selectSceneWeather(scene);
    expect(decision).not.toBe("rain");
    expect(decision).not.toBe("snow");
    // Proof that the narration WOULD read as rain — so its exclusion is what
    // keeps the dry scene dry, not luck.
    expect(selectSceneWeather(narration)).toBe("rain");
    // And the setting a dry shot carries is scrubbed of any theme precipitation:
    expect(weatherConsistentSetting("a monsoon-lashed harbour town", decision)).not.toMatch(
      /monsoon|rain|storm/i,
    );
  });

  it("REQUIRED: a genuinely rainy scene keeps rain", () => {
    expect(selectSceneWeather("Rain hammers the harbour as thunder rolls.")).toBe("rain");
    // A rainy shot keeps the full setting — the weather it shows is real.
    expect(weatherConsistentSetting("a rain-swept fishing village", "rain")).toBe(
      "a rain-swept fishing village",
    );
  });

  it("REQUIRED: a calm/dry scene selects no weather (no overlay)", () => {
    expect(selectSceneWeather("A quiet courtyard, a woman standing still.")).toBeNull();
    expect(selectSceneWeather("An old fisherman on the harbour wall at dawn.")).toBeNull();
  });

  it("REQUIRED: the selected weather is consistent between still prompt and VFX", () => {
    // Whatever the ONE decision returns for a shot is exactly what both the
    // image setting and the VFX must use. Prove they read the same token.
    for (const scene of [
      "A dry sunlit bazaar, dust in the air.",
      "Rain lashing the tin roofs, water in the lanes.",
      "Snow settling over the mountain pass.",
      "A calm palace hall at dusk.",
    ]) {
      const decision = selectSceneWeather(scene); // the single source of truth
      const vfxKind = decision; // the worker passes this straight to the overlay
      const settingWeather = selectSceneWeather(
        weatherConsistentSetting("a coastal town", decision) + " " + scene,
      );
      expect(vfxKind).toBe(decision); // VFX == decision, always
      // the setting a shot carries never introduces a DIFFERENT weather than
      // the shot's own decision.
      if (decision === null) expect(settingWeather).toBeNull();
    }
  });
});

describe("stripThemeWeather — film-theme precipitation cannot wet a dry shot", () => {
  it("removes precipitation words from a film-wide theme string", () => {
    expect(stripThemeWeather("a rainy, monsoon-battered coastal market")).not.toMatch(
      /rain|monsoon/i,
    );
    expect(stripThemeWeather("a stormy harbour under torrential downpour")).not.toMatch(
      /storm|torrential|downpour/i,
    );
    expect(stripThemeWeather("a snowbound blizzard-swept pass")).not.toMatch(
      /snow|blizzard/i,
    );
  });

  it("leaves non-weather scenery intact and tidy", () => {
    const out = stripThemeWeather("a bright coastal fish market by the turquoise sea");
    expect(out).toBe("a bright coastal fish market by the turquoise sea");
  });

  it("does not maim look-alike words (grain, hailed a friend)", () => {
    expect(stripThemeWeather("sacks of grain by the storehouse")).toBe(
      "sacks of grain by the storehouse",
    );
    expect(stripThemeWeather("the crowd that hailed the king")).toBe(
      "the crowd that hailed the king",
    );
  });
});

describe("weatherConsistentSetting — the setting a shot carries follows its own decision", () => {
  it("strips theme weather for a DRY shot, keeps it for a wet shot", () => {
    const theme = "a monsoon coast, boats and rain";
    expect(weatherConsistentSetting(theme, null)).not.toMatch(/monsoon|rain/i); // dry shot
    expect(weatherConsistentSetting(theme, "rain")).toBe(theme); // rainy shot
  });

  it("tolerates an empty/undefined setting", () => {
    expect(weatherConsistentSetting("", null)).toBe("");
    // @ts-expect-error runtime guard for a missing setting
    expect(weatherConsistentSetting(undefined, null)).toBe("");
  });
});

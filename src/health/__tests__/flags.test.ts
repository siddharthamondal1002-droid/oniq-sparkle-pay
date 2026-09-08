/**
 * THE TWELVE FLAGS ARE OFF, NAMED AS THE OWNER NAMED THEM, AND THE SERVER
 * KNOWS THE SAME TWELVE.
 *
 * Owner brief, 2026-09-08: every ONIQ Health feature ships behind these
 * switches — the eleven of the mapping, plus `health.provider_sharing.enabled`
 * from §83C of the same brief ("Default: ALL = false"). The list below is
 * typed out from the brief on purpose — the code carrying the names cannot
 * be the thing that checks the names.
 */
import { describe, expect, it } from "vitest";
import {
  HEALTH_AI_ENABLED,
  HEALTH_ENABLED,
  HEALTH_FLAGS,
  HEALTH_FLAG_NAMES,
  HEALTH_UPLOADS_ENABLED,
  healthFlag,
} from "@/health/flags";
import {
  HEALTH_FLAG_COLUMNS as SERVER_COLUMNS,
  HEALTH_FLAG_NAMES as SERVER_NAMES,
  allHealthFlagsOff,
} from "../../../supabase/functions/_shared/health/flagNames.ts";
import {
  aiKillSwitchFromRow,
  environmentFromRow,
  flagsFromRow,
} from "../../../supabase/functions/_shared/health/flags.ts";

const FROM_THE_BRIEF = [
  "health.enabled",
  "health.uploads.enabled",
  "health.ai.enabled",
  "health.health_connect.enabled",
  "health.abdm.enabled",
  "health.fhir.enabled",
  "health.dicom.enabled",
  "health.hl7.enabled",
  "health.medgemma.enabled",
  "health.healthcare_search.enabled",
  "health.research.enabled",
  "health.provider_sharing.enabled",
];

describe("the client flags", () => {
  it("are exactly the twelve the brief names", () => {
    expect([...HEALTH_FLAG_NAMES]).toEqual(FROM_THE_BRIEF);
    expect(Object.keys(HEALTH_FLAGS).sort()).toEqual([...FROM_THE_BRIEF].sort());
  });

  it("are all off — Phases 1 and 2 are dark", () => {
    for (const name of HEALTH_FLAG_NAMES) expect(HEALTH_FLAGS[name], name).toBe(false);
    expect(HEALTH_ENABLED).toBe(false);
    expect(HEALTH_UPLOADS_ENABLED).toBe(false);
    expect(HEALTH_AI_ENABLED).toBe(false);
  });

  it("gate every feature on the master switch", () => {
    const before = HEALTH_FLAGS["health.uploads.enabled"];
    HEALTH_FLAGS["health.uploads.enabled"] = true;
    try {
      expect(healthFlag("health.uploads.enabled")).toBe(false);
    } finally {
      HEALTH_FLAGS["health.uploads.enabled"] = before;
    }
  });

  it("refuse a flag nobody declared", () => {
    expect(() => healthFlag("health.nonsense" as never)).toThrow(/unknown health flag/);
  });
});

describe("the server flags", () => {
  it("name the same twelve, in the same order", () => {
    expect([...SERVER_NAMES]).toEqual([...HEALTH_FLAG_NAMES]);
  });

  it("map each to a distinct snake_case column", () => {
    const cols = Object.values(SERVER_COLUMNS);
    expect(new Set(cols).size).toBe(cols.length);
    for (const c of cols) expect(c).toMatch(/^([a-z0-9_]+_)?enabled$/);
  });

  it("resolve a missing row to everything off", () => {
    expect(flagsFromRow(null)).toEqual(allHealthFlagsOff());
    expect(flagsFromRow(undefined)).toEqual(allHealthFlagsOff());
    expect(flagsFromRow("garbage" as never)).toEqual(allHealthFlagsOff());
  });

  it("read the row when the master switch is on", () => {
    const flags = flagsFromRow({ enabled: true, uploads_enabled: true, ai_enabled: "true" });
    expect(flags["health.enabled"]).toBe(true);
    expect(flags["health.uploads.enabled"]).toBe(true);
    // A string "true" is not true; only the boolean counts.
    expect(flags["health.ai.enabled"]).toBe(false);
    expect(flags["health.abdm.enabled"]).toBe(false);
  });

  it("ignore every other column while the master switch is off", () => {
    const flags = flagsFromRow({ enabled: false, uploads_enabled: true, fhir_enabled: true });
    expect(flags).toEqual(allHealthFlagsOff());
  });

  it("the kill switch forces every AI flag off and nothing else — and only the boolean true counts", () => {
    // Owner directive 2026-09-08: a global emergency stop for Health AI.
    const on = {
      enabled: true,
      uploads_enabled: true,
      ai_enabled: true,
      provider_sharing_enabled: true,
    };
    const live = flagsFromRow(on);
    expect(live["health.ai.enabled"]).toBe(true);
    expect(live["health.provider_sharing.enabled"]).toBe(true);

    const killed = flagsFromRow({ ...on, ai_kill_switch: true });
    expect(killed["health.ai.enabled"]).toBe(false);
    expect(killed["health.provider_sharing.enabled"]).toBe(false);
    // The stop is for AI, not for Health: records and uploads stay reachable.
    expect(killed["health.enabled"]).toBe(true);
    expect(killed["health.uploads.enabled"]).toBe(true);

    expect(aiKillSwitchFromRow({ ai_kill_switch: true })).toBe(true);
    expect(aiKillSwitchFromRow({ ai_kill_switch: false })).toBe(false);
    expect(aiKillSwitchFromRow(null)).toBe(false);
    for (const v of ["true", 1, "on", {}, []]) {
      expect(aiKillSwitchFromRow({ ai_kill_switch: v }), JSON.stringify(v)).toBe(false);
      expect(
        flagsFromRow({ ...on, ai_kill_switch: v })["health.ai.enabled"],
        JSON.stringify(v),
      ).toBe(true);
    }
  });

  it("default the environment to production", () => {
    expect(environmentFromRow(null)).toBe("production");
    expect(environmentFromRow({ environment: "" })).toBe("production");
    expect(environmentFromRow({ environment: "staging" })).toBe("staging");
  });
});

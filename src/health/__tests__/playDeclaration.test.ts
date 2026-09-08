/**
 * THE PLAY DATA SAFETY FORM MOVES WITH THE FLAG.
 *
 * playCompliance.ts records the lesson: a declaration that claims less than
 * the app collects is a policy violation, and one that claims more is a
 * false statement in the other direction. Today ONIQ stores no health
 * documents, so DATA_COLLECTED must not say it does. The day
 * `health.uploads.enabled` flips, this test goes red until an entry for
 * health records and documents is written — one assertion, both directions,
 * so it cannot go vacuous when the flag changes.
 */
import { describe, expect, it } from "vitest";
import { DATA_COLLECTED, NATIVE_CAPABILITIES } from "@/config/playCompliance";
import { HEALTH_UPLOADS_ENABLED } from "@/health/flags";

const claimsHealthRecords = DATA_COLLECTED.some(
  (d) =>
    /health record|medical record|health document/i.test(d.category) ||
    /health record|medical report|prescription|discharge summary/i.test(d.what),
);

describe("Data safety and the uploads flag", () => {
  it("declares health documents exactly when they can be collected", () => {
    expect(claimsHealthRecords).toBe(HEALTH_UPLOADS_ENABLED);
  });

  it("still declares the Vitals check-ins that are collected today", () => {
    expect(DATA_COLLECTED.some((d) => d.category === "Health and fitness")).toBe(true);
  });

  it("claims no ONIQ Health capability while the doors are shut", () => {
    expect(NATIVE_CAPABILITIES.some((c) => /ONIQ Health/.test(c))).toBe(false);
  });
});

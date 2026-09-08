import { describe, expect, it } from "vitest";
import { PLACEHOLDER_RETENTION, expiryFor, isRetentionExpired } from "@/health/retention";
import { DATA_CATEGORIES } from "@/health/domain";

describe("retention arithmetic", () => {
  it("adds the policy's days to the write time", () => {
    const from = "2026-09-08T00:00:00.000Z";
    expect(expiryFor("documents", from, PLACEHOLDER_RETENTION)).toBe(
      new Date(Date.parse(from) + 3650 * 86400000).toISOString(),
    );
    expect(expiryFor("device_metrics", from, PLACEHOLDER_RETENTION)).toBe(
      new Date(Date.parse(from) + 730 * 86400000).toISOString(),
    );
  });

  it("keeps for the life of the account when there is no policy or a bad one", () => {
    expect(
      expiryFor("something_new", "2026-09-08T00:00:00.000Z", PLACEHOLDER_RETENTION),
    ).toBeNull();
    expect(
      expiryFor("documents", "2026-09-08T00:00:00.000Z", [
        { category: "documents", retentionDays: 0 },
      ]),
    ).toBeNull();
    expect(expiryFor("documents", "not a date", PLACEHOLDER_RETENTION)).toBeNull();
  });

  it("has a placeholder for every data category", () => {
    for (const c of DATA_CATEGORIES) {
      expect(
        PLACEHOLDER_RETENTION.find((p) => p.category === c),
        c,
      ).toBeTruthy();
    }
  });

  it("reads expiry as inclusive of the instant", () => {
    expect(isRetentionExpired("2026-09-08T00:00:00.000Z", "2026-09-08T00:00:00.000Z")).toBe(true);
    expect(isRetentionExpired("2026-09-08T00:00:01.000Z", "2026-09-08T00:00:00.000Z")).toBe(false);
    expect(isRetentionExpired(null, "2026-09-08T00:00:00.000Z")).toBe(false);
  });
});

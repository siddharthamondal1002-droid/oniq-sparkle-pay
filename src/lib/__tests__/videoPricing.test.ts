// Two copies of a price is exactly the drift that shows up first on a bill —
// so the TS display copy and the migration seed are held to agree, the same
// contract storyPricingSql.test.ts enforces for Story time. The database is
// the one that charges; this file is the one screens render from.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  VIDEO_CLEAN_ADDON_PAISE_PER_MINUTE,
  VIDEO_PAYG_MINUTES,
  VIDEO_PAYG_PAISE_PER_MINUTE,
  VIDEO_PLANS,
  VIDEO_TRIAL_SECONDS,
  readVideoTimeStatus,
  sayVideoTime,
  totalRemainingMs,
} from "@/lib/videoPricing";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260827200000_video_time_monetization.sql"),
  "utf8",
);

describe("the TS copy agrees with the SQL that charges", () => {
  it("PAYG rate and the clean addon", () => {
    expect(SQL).toContain(
      `payg_paise_per_minute int not null default ${VIDEO_PAYG_PAISE_PER_MINUTE}`,
    );
    expect(SQL).toContain(
      `clean_addon_paise_per_minute int not null default ${VIDEO_CLEAN_ADDON_PAISE_PER_MINUTE}`,
    );
  });

  it("the plan rows", () => {
    for (const p of VIDEO_PLANS) {
      const entitlements = p.watermarkFree ? "'{no_watermark}'" : "'{}'";
      expect(SQL, p.key).toContain(
        `('${p.key}', '${p.label}', 'auto_renew', 'P1M', ${p.pricePaise}, 0, ${p.includedSeconds}, ${entitlements}, false,`,
      );
    }
  });

  it("the trial grant", () => {
    expect(SQL).toContain(`trial_ms_granted bigint not null default ${VIDEO_TRIAL_SECONDS * 1000}`);
  });

  it("the PAYG tier list", () => {
    expect(SQL).toContain(`_minutes not in (${VIDEO_PAYG_MINUTES.join(", ")})`);
  });
});

describe("owner arithmetic, stated once", () => {
  it("₹29/min watermarked, ₹49/min clean, ₹199 and ₹349 plans", () => {
    expect(VIDEO_PAYG_PAISE_PER_MINUTE).toBe(2900);
    expect(VIDEO_PAYG_PAISE_PER_MINUTE + VIDEO_CLEAN_ADDON_PAISE_PER_MINUTE).toBe(4900);
    expect(VIDEO_PLANS.find((p) => p.key === "creator_monthly")?.pricePaise).toBe(19900);
    expect(VIDEO_PLANS.find((p) => p.key === "pro_monthly")?.pricePaise).toBe(34900);
    // 30 and 60 minutes, as seconds — integers, never floats.
    expect(VIDEO_PLANS.map((p) => p.includedSeconds)).toEqual([1800, 3600]);
  });

  it("only Pro is watermark-free", () => {
    expect(VIDEO_PLANS.filter((p) => p.watermarkFree).map((p) => p.key)).toEqual(["pro_monthly"]);
  });
});

describe("the status reader", () => {
  it("reads defensively and never invents balance", () => {
    expect(readVideoTimeStatus(null)).toBeNull();
    const s = readVideoTimeStatus({
      salesEnabled: true,
      trialEnabled: true,
      trialRemainingMs: 60000,
      plan: "free",
      planRemainingMs: 0,
      paidMs: 120000,
      watermarkFree: false,
    });
    expect(s).not.toBeNull();
    expect(totalRemainingMs(s!)).toBe(180000);
    // Negative or missing numbers read as zero, not as allowance.
    const bad = readVideoTimeStatus({ trialRemainingMs: -5 });
    expect(bad!.trialRemainingMs).toBe(0);
  });

  it("speaks customer time, never GPU numbers", () => {
    expect(sayVideoTime(60000)).toBe("1:00");
    expect(sayVideoTime(4041)).toBe("0:04");
    expect(sayVideoTime(0)).toBe("0:00");
    expect(sayVideoTime(-100)).toBe("0:00");
  });
});

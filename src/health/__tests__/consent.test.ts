import { describe, expect, it } from "vitest";
import { consentCovers, findCovering, isPastExpiry, nextVersion } from "@/health/consent";
import {
  CATEGORY_FOR_KIND,
  CONSENT_PURPOSES,
  DATA_CATEGORIES,
  PHASE1_GRANTABLE_PURPOSES,
  RECIPIENTS,
  RECIPIENT_FOR_PURPOSE,
  RECORD_KINDS,
} from "@/health/domain";

const NOW = "2026-09-08T12:00:00.000Z";

const base = {
  purpose: "store_records",
  dataCategories: ["vitals", "documents"],
  recipient: "oniq",
  status: "active",
  startTime: "2026-09-01T00:00:00.000Z",
  expiryTime: null as string | null,
};

const need = { purpose: "store_records", category: "vitals", recipient: "oniq" };

describe("consentCovers — every clause refuses on its own", () => {
  it("covers the plain case", () => {
    expect(consentCovers(base, need, NOW)).toBe(true);
  });

  it("refuses when revoked or expired by status", () => {
    expect(consentCovers({ ...base, status: "revoked" }, need, NOW)).toBe(false);
    expect(consentCovers({ ...base, status: "expired" }, need, NOW)).toBe(false);
  });

  it("refuses a different purpose, recipient or category", () => {
    expect(consentCovers(base, { ...need, purpose: "ai_interpretation" }, NOW)).toBe(false);
    expect(consentCovers(base, { ...need, recipient: "google_vertex" }, NOW)).toBe(false);
    expect(consentCovers(base, { ...need, category: "labs" }, NOW)).toBe(false);
  });

  it("refuses before the start and at or after the expiry", () => {
    expect(consentCovers({ ...base, startTime: "2026-09-09T00:00:00.000Z" }, need, NOW)).toBe(
      false,
    );
    expect(consentCovers({ ...base, expiryTime: NOW }, need, NOW)).toBe(false);
    expect(consentCovers({ ...base, expiryTime: "2026-09-08T12:00:01.000Z" }, need, NOW)).toBe(
      true,
    );
  });

  it("refuses unparseable times rather than guessing", () => {
    expect(consentCovers({ ...base, startTime: "yesterday" }, need, NOW)).toBe(false);
    expect(consentCovers(base, need, "now")).toBe(false);
  });
});

describe("findCovering, isPastExpiry, nextVersion", () => {
  it("returns the first covering consent and null otherwise", () => {
    const revoked = { ...base, status: "revoked" };
    expect(findCovering([revoked, base], need, NOW)).toBe(base);
    expect(findCovering([revoked], need, NOW)).toBeNull();
  });

  it("flags a row whose expiry passed while its status still says active", () => {
    expect(isPastExpiry({ ...base, expiryTime: "2026-09-08T11:59:59.000Z" }, NOW)).toBe(true);
    expect(isPastExpiry(base, NOW)).toBe(false);
  });

  it("increments per purpose and recipient, never globally", () => {
    const rows = [
      { purpose: "store_records", recipient: "oniq", version: 2 },
      { purpose: "store_records", recipient: "oniq", version: 1 },
      { purpose: "ai_interpretation", recipient: "google_vertex", version: 7 },
    ];
    expect(nextVersion(rows, "store_records", "oniq")).toBe(3);
    expect(nextVersion(rows, "ai_interpretation", "google_vertex")).toBe(8);
    expect(nextVersion(rows, "abdm_exchange", "abdm")).toBe(1);
  });
});

describe("the closed lists hang together", () => {
  it("every record kind maps to a declared category", () => {
    for (const k of RECORD_KINDS) expect(DATA_CATEGORIES).toContain(CATEGORY_FOR_KIND[k]);
  });

  it("every purpose names a declared recipient, and Phase 1 grants only storage", () => {
    for (const p of CONSENT_PURPOSES) expect(RECIPIENTS).toContain(RECIPIENT_FOR_PURPOSE[p]);
    expect([...PHASE1_GRANTABLE_PURPOSES]).toEqual(["store_records"]);
    expect(RECIPIENT_FOR_PURPOSE.store_records).toBe("oniq");
    expect(RECIPIENT_FOR_PURPOSE.ai_interpretation).toBe("google_vertex");
  });
});

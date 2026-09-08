import { describe, expect, it } from "vitest";
import {
  DISCLOSED_RECIPIENTS_BY_TERMS,
  consentCovers,
  findCovering,
  isPastExpiry,
  nextVersion,
  termsDisclose,
} from "@/health/consent";
import {
  CATEGORY_FOR_KIND,
  CONSENT_PURPOSES,
  CONSENT_TERMS_VERSIONS,
  DATA_CATEGORIES,
  GRANTABLE_CONSENTS,
  GRANTABLE_PURPOSES,
  RECIPIENTS,
  RECORD_KINDS,
  isGrantable,
} from "@/health/domain";

const NOW = "2026-09-08T12:00:00.000Z";

const base = {
  purpose: "store_records",
  dataCategories: ["vitals", "documents"],
  recipient: "oniq",
  status: "active",
  startTime: "2026-09-01T00:00:00.000Z",
  expiryTime: null as string | null,
  termsVersion: "health-terms-v1",
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

  it("refuses a row whose terms never disclosed the recipient, whatever the column says", () => {
    // The row SAYS google_vertex; the notice it was granted under mentioned
    // only ONIQ. Editing the column cannot widen what the person agreed to.
    const edited = { ...base, purpose: "ai_interpretation", recipient: "google_vertex" };
    const aiNeed = { purpose: "ai_interpretation", category: "vitals", recipient: "google_vertex" };
    expect(consentCovers(edited, aiNeed, NOW)).toBe(false);
    expect(consentCovers({ ...edited, termsVersion: "unknown-v9" }, aiNeed, NOW)).toBe(false);
    expect(termsDisclose("health-ai-terms-v1", "oniq")).toBe(true);
    expect(termsDisclose("health-ai-terms-v1", "google_vertex")).toBe(false);
    expect(termsDisclose("__proto__", "oniq")).toBe(false);
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

  it("Phase 2 grants storage and AI-by-ONIQ, both to ONIQ, and nothing else", () => {
    expect(GRANTABLE_CONSENTS).toEqual([
      { purpose: "store_records", recipient: "oniq" },
      { purpose: "ai_interpretation", recipient: "oniq" },
    ]);
    expect([...GRANTABLE_PURPOSES]).toEqual(["store_records", "ai_interpretation"]);
    for (const g of GRANTABLE_CONSENTS) {
      expect(CONSENT_PURPOSES).toContain(g.purpose);
      expect(RECIPIENTS).toContain(g.recipient);
      expect(g.recipient).toBe("oniq");
    }
    expect(isGrantable("ai_interpretation", "google_vertex")).toBe(false);
    expect(isGrantable("share_with_clinician", "clinician")).toBe(false);
    expect(isGrantable("store_records", "oniq")).toBe(true);
  });

  it("every grantable pair is disclosed by its purpose's terms version", () => {
    for (const p of CONSENT_PURPOSES) {
      expect(DISCLOSED_RECIPIENTS_BY_TERMS, p).toHaveProperty(CONSENT_TERMS_VERSIONS[p]);
    }
    for (const g of GRANTABLE_CONSENTS) {
      expect(termsDisclose(CONSENT_TERMS_VERSIONS[g.purpose], g.recipient), g.purpose).toBe(true);
    }
    // And no version discloses anything that leaves ONIQ: Phase 2 has no such recipient.
    for (const disclosed of Object.values(DISCLOSED_RECIPIENTS_BY_TERMS)) {
      expect(disclosed).toEqual(["oniq"]);
    }
    expect(CONSENT_TERMS_VERSIONS.ai_interpretation).not.toBe(CONSENT_TERMS_VERSIONS.store_records);
  });
});

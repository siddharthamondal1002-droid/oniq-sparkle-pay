import { describe, expect, it } from "vitest";
import {
  CONSENT_PURPOSES,
  NOTICE_VERSION,
  REGIME_BEHAVIOUR,
  defaultPurposeState,
  resolveNoticeLocale,
  tr,
} from "@/lib/consent/notice";
import { COUNTRY_REGISTRY } from "@/data/countryRegistry";
import { resolveJurisdiction } from "@/lib/consent/ledger";

describe("consent notice", () => {
  it("is versioned", () => {
    expect(NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./);
  });

  it("exists in English and Hindi for every purpose and category", () => {
    for (const p of CONSENT_PURPOSES) {
      for (const loc of ["en", "hi"] as const) {
        expect(tr(p.title, loc).length).toBeGreaterThan(0);
        expect(tr(p.purpose, loc).length).toBeGreaterThan(0);
        for (const c of p.categories) expect(tr(c.label, loc).length).toBeGreaterThan(0);
      }
      // Hindi must actually be translated, not English echoed back.
      expect(p.purpose.hi).not.toBe(p.purpose.en);
    }
  });

  it("itemises categories per purpose", () => {
    for (const p of CONSENT_PURPOSES) expect(p.categories.length).toBeGreaterThan(0);
  });

  it("keeps behavioural personalisation as its own non-essential purpose", () => {
    const p = CONSENT_PURPOSES.find((x) => x.id === "personalisation");
    expect(p).toBeTruthy();
    expect(p?.essential).toBeFalsy();
  });

  it("falls back to English for unknown languages", () => {
    expect(resolveNoticeLocale("ta")).toBe("en");
    expect(resolveNoticeLocale(undefined)).toBe("en");
    expect(resolveNoticeLocale("hi")).toBe("hi");
  });

  it("covers every legal regime in the registry — one module, seven behaviours", () => {
    for (const cfg of Object.values(COUNTRY_REGISTRY)) {
      expect(REGIME_BEHAVIOUR[cfg.legalRegime]).toBeTruthy();
    }
  });

  it("only opt-out regimes start a non-essential purpose on", () => {
    expect(defaultPurposeState("DPDP")).toBe(false);
    expect(defaultPurposeState("UKGDPR")).toBe(false);
    expect(defaultPurposeState("PDPL")).toBe(false);
    expect(defaultPurposeState("PIPEDA")).toBe(false);
    expect(defaultPurposeState("US_STATE")).toBe(true);
  });

  it("resolves jurisdiction from home country", () => {
    expect(resolveJurisdiction("IN")).toBe("DPDP");
    expect(resolveJurisdiction("AE")).toBe("PDPL");
    expect(resolveJurisdiction(null)).toBe(COUNTRY_REGISTRY.IN.legalRegime);
  });
});

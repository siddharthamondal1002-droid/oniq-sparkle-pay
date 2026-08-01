// Registry integrity — Phase 7 checks, run in CI. These are the code-level
// guarantees the SUPER LOOP demands: manifest/data sync, launch-safety rules,
// government allowlist, and the hard dating-app exclusion.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_REGISTRY,
  ALL_COUNTRIES,
  effectiveLaunchType,
  queryPackageIds,
  visibleApps,
} from "@/data/appRegistry";
import { BLOCKLISTED_HOSTS, OFFICIAL_LINKS, isAllowedGovHost } from "@/data/officialLinks";

const MANIFEST = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

// Hard content rule: no dating / hookup / romantic-discovery apps, ever.
const DATING_BLOCKLIST = [
  "tinder",
  "bumble",
  "hinge",
  "grindr",
  "muzz",
  "aisle",
  "trulymadly",
  "okcupid",
  "happn",
  "badoo",
  "quackquack",
  "woo.dating",
];

describe("app registry integrity", () => {
  it("every entry has a webUrl", () => {
    for (const a of APP_REGISTRY) {
      expect(a.webUrl?.startsWith("https://"), a.id).toBe(true);
    }
  });

  it("every verified package entry appears in AndroidManifest <queries>", () => {
    for (const pkg of queryPackageIds()) {
      expect(MANIFEST.includes(`<package android:name="${pkg}" />`), pkg).toBe(true);
    }
  });

  it("QUERY_ALL_PACKAGES is never requested", () => {
    expect(MANIFEST.includes("QUERY_ALL_PACKAGES")).toBe(false);
  });

  it("verified:false always resolves to webOnly at runtime", () => {
    for (const a of APP_REGISTRY.filter((a) => !a.verified)) {
      expect(effectiveLaunchType(a), a.id).toBe("webOnly");
    }
  });

  it("no non-active or hidden entry ever renders", () => {
    for (const country of ALL_COUNTRIES) {
      for (const a of visibleApps(country)) {
        expect(a.status, a.id).toBe("active");
        expect(a.hidden ?? false, a.id).toBe(false);
      }
    }
    // history rows exist but are excluded
    expect(APP_REGISTRY.some((a) => a.status === "merged" && a.replacedBy === "jiohotstar")).toBe(
      true,
    );
    expect(APP_REGISTRY.some((a) => a.id === "blusmart" && a.status === "shutdown")).toBe(true);
    expect(APP_REGISTRY.some((a) => a.id === "oniq-upi" && a.hidden === true)).toBe(true);
  });

  it("contains no dating/hookup app, by id, name or package", () => {
    for (const a of APP_REGISTRY) {
      const hay = `${a.id} ${a.name} ${a.packageId ?? ""} ${a.webUrl}`.toLowerCase();
      for (const bad of DATING_BLOCKLIST) {
        expect(hay.includes(bad), `${a.id} vs ${bad}`).toBe(false);
      }
    }
  });

  it("no seeded country renders an empty grid for core categories", () => {
    for (const country of ALL_COUNTRIES) {
      for (const cat of [
        "rides",
        "food",
        "payments",
        "social",
        "shopping",
        "beauty",
        "fashion",
        "entertainment",
      ] as const) {
        expect(visibleApps(country, cat).length, `${country}/${cat}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("official (government) directory", () => {
  it("every government URL passes the host allowlist", () => {
    for (const l of OFFICIAL_LINKS.filter((l) => l.kind === "gov")) {
      expect(isAllowedGovHost(l.url), `${l.id}: ${l.url}`).toBe(true);
    }
  });

  it("partners are never badged as government and never on gov domains", () => {
    const partners = OFFICIAL_LINKS.filter((l) => l.kind === "partner");
    expect(partners.length).toBeGreaterThan(0);
    for (const p of partners) {
      expect(isAllowedGovHost(p.url), p.id).toBe(false);
    }
  });

  it("blocklisted lookalike hosts are rejected", () => {
    expect(BLOCKLISTED_HOSTS).toContain("australianetaapp.com");
    expect(isAllowedGovHost("https://australianetaapp.com")).toBe(false);
    expect(isAllowedGovHost("https://www.india-evisa.org")).toBe(false);
    expect(isAllowedGovHost("https://evisa-gov.com")).toBe(false);
  });

  it("ships the exact Phase-5 visa entry points for all seven countries", () => {
    const urls = OFFICIAL_LINKS.filter((l) => l.category === "visa" && l.kind === "gov").map(
      (l) => l.url,
    );
    for (const u of [
      "https://indianvisaonline.gov.in/evisa/",
      "https://ceac.state.gov/genniv/",
      "https://esta.cbp.dhs.gov",
      "https://www.gov.uk/browse/visas-immigration",
      "https://icp.gov.ae",
      "https://gdrfad.gov.ae",
      "https://www.canada.ca/en/immigration-refugees-citizenship.html",
      "https://immi.homeaffairs.gov.au",
      "https://www.ica.gov.sg",
      "https://eservices.ica.gov.sg/sgarrivalcard",
    ]) {
      expect(urls).toContain(u);
    }
  });

  it("every country has at least a visa entry", () => {
    for (const c of ALL_COUNTRIES) {
      expect(
        OFFICIAL_LINKS.some((l) => l.country === c && l.category === "visa" && l.kind === "gov"),
        c,
      ).toBe(true);
    }
  });
});

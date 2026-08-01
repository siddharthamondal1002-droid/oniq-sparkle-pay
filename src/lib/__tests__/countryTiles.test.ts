import { describe, expect, it } from "vitest";
import { MINI_APPS, CATEGORY_LABELS, appAvailableIn, type CountryCode, type MiniApp } from "@/lib/miniapps";
import { resolveTileLabel } from "@/lib/i18n/tileLabel";

const ALL_COUNTRIES: CountryCode[] = ["IN", "US", "GB", "AE", "CA", "AU", "SG"];
const CATEGORIES: MiniApp["category"][] = [
  "food", "rides", "quickcommerce", "payments", "social", "shopping", "beauty", "fashion", "entertainment",
];

function appsFor(country: CountryCode, category: MiniApp["category"]) {
  return MINI_APPS.filter((a) => a.category === category && appAvailableIn(a, country));
}

describe("tile label resolution", () => {
  it("uses the original label for every non-Hindi locale", () => {
    expect(resolveTileLabel("en", "the plug 🔌", "जुगाड़")).toBe("the plug 🔌");
    expect(resolveTileLabel("ta", "the plug 🔌", "जुगाड़")).toBe("the plug 🔌");
    expect(resolveTileLabel("bn", "Watch", "देखो")).toBe("Watch");
  });
  it("uses labelHi only for hi, falling back to label when absent", () => {
    expect(resolveTileLabel("hi", "the plug 🔌", "जुगाड़")).toBe("जुगाड़");
    expect(resolveTileLabel("hi", "Netflix")).toBe("Netflix");
  });
  it("every category carries both label fields", () => {
    for (const cat of CATEGORIES) {
      expect(CATEGORY_LABELS[cat].label.length).toBeGreaterThan(0);
      expect(CATEGORY_LABELS[cat].labelHi.length).toBeGreaterThan(0);
    }
  });
});

describe("country-scoped app registry", () => {
  it("every app declares countries", () => {
    for (const app of MINI_APPS) {
      expect(app.countries === "*" || app.countries.length > 0).toBe(true);
    }
  });

  it("no seeded country renders an empty grid for the core categories", () => {
    for (const country of ALL_COUNTRIES) {
      for (const cat of ["rides", "food", "payments", "social", "shopping", "beauty", "fashion", "entertainment"] as const) {
        expect(appsFor(country, cat).length, `${country}/${cat}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps India-only brands out of other countries", () => {
    const usIds = new Set(MINI_APPS.filter((a) => appAvailableIn(a, "US")).map((a) => a.id));
    for (const id of ["nykaa", "myntra", "jiohotstar", "phonepe", "paytm", "flipkart", "swiggy"]) {
      expect(usIds.has(id), id).toBe(false);
    }
  });

  it("global apps appear everywhere", () => {
    for (const country of ALL_COUNTRIES) {
      const ids = new Set(MINI_APPS.filter((a) => appAvailableIn(a, country)).map((a) => a.id));
      expect(ids.has("netflix"), `netflix in ${country}`).toBe(true);
      expect(ids.has("primevideo"), `primevideo in ${country}`).toBe(true);
    }
  });

  it("renders JioHotstar as one merged IN entry — JioCinema/Hotstar are history rows", () => {
    const rendered = MINI_APPS.filter(
      (a) => a.status === "active" && !a.hidden && a.category === "entertainment",
    ).map((a) => a.name.toLowerCase());
    expect(rendered.filter((n) => n.includes("hotstar") || n.includes("jiocinema"))).toEqual(["jiohotstar"]);
    const jio = MINI_APPS.find((a) => a.id === "jiohotstar")!;
    expect(jio.countries).toEqual(["IN"]);
  });

  it("Beauty and Fashion carry the requested India sets", () => {
    const inBeauty = appsFor("IN", "beauty").map((a) => a.name);
    for (const n of ["Nykaa", "Tira", "Purplle", "Sugar Cosmetics", "MyGlamm"]) expect(inBeauty).toContain(n);
    const inFashion = appsFor("IN", "fashion").map((a) => a.name);
    for (const n of ["Myntra", "AJIO", "Meesho", "Nykaa Fashion", "Bewakoof"]) expect(inFashion).toContain(n);
  });

  it("Entertainment India set matches the brief", () => {
    const names = appsFor("IN", "entertainment").map((a) => a.name);
    for (const n of ["Netflix", "Amazon Prime Video", "JioHotstar", "SonyLIV", "ZEE5", "MX Player"]) {
      expect(names).toContain(n);
    }
  });
});

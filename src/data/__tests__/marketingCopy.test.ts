/**
 * Public claims, as tests.
 *
 * Twice a feature was removed and its marketing stayed behind: the site sold
 * "live TV" after the streams were deleted, and advertised Watch after the
 * whole surface was deleted. Both times the copy sat in JSX where nothing
 * could check it against reality.
 *
 * These tests close that loop. A live card must point at a route file that
 * exists on disk, so deleting a surface breaks the build until its copy goes
 * too. That is the whole point — the failure should be loud and at commit
 * time, not quiet and on the front page.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BANNED_CLAIMS,
  COUNTRIES_SUPPORTED,
  DELIBERATELY_ABSENT,
  FEATURE_CARDS,
  HERO,
  NOT_AFFILIATED,
  PLAY_LISTING,
  PRIVACY_BAND,
  SCOUT_LANGUAGES,
  WORLDS_LIVE,
} from "@/data/marketingCopy";
import { ALL_COUNTRIES } from "@/data/appRegistry";

const ROOT = process.cwd();
const landing = readFileSync(join(ROOT, "src/routes/index.tsx"), "utf8");
const root = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf8");

/** "/app/chat/moments" -> src/routes/_authenticated/app.chat.moments.tsx */
function routeFileFor(route: string): string {
  const rest = route.replace(/^\/app\/?/, "");
  const base = rest === "" ? "index" : rest.replace(/\//g, ".");
  return join(ROOT, "src/routes/_authenticated", `app.${base}.tsx`);
}

describe("every live card maps to a surface that exists", () => {
  it.each(FEATURE_CARDS.filter((c) => c.status === "live").map((c) => [c.title, c.route] as const))(
    "%s -> %s",
    (title, route) => {
      expect(route, `${title} is live but has no route`).toBeTruthy();
      const file = routeFileFor(route!);
      expect(
        existsSync(file),
        `${title} promises ${route} but ${file.slice(ROOT.length + 1)} does not exist`,
      ).toBe(true);
    },
  );

  it("coming-soon cards promise no route at all", () => {
    for (const c of FEATURE_CARDS.filter((c) => c.status === "soon")) {
      expect(c.route, `${c.title} is 'soon' but links somewhere`).toBeNull();
    }
  });

  it("advertises Scan & Pay, but still no Receive card", () => {
    // Owner directive, 2026-09-06: "Make upi active again", reversing
    // 2026-08-17. Scan & Pay is back and LIVE — the surface exists and the app
    // offers a way in, which is the only status this deck permits.
    const scan = FEATURE_CARDS.find((c) => c.title === "Scan & Pay");
    expect(scan, "Scan & Pay is missing — check appRegistry oniq-upi agrees").toBeTruthy();
    expect(scan?.status).toBe("live");
    expect(scan?.route).toBe("/app/upi");

    // RECEIVE DID NOT COME BACK WITH IT, and that asymmetry is the assertion.
    // There is no receive route — src/routes/_authenticated/ holds app.upi.tsx
    // and app.scan.tsx and nothing else — so a Receive card would promise a
    // screen that does not exist. That is the failure this whole file exists
    // to catch, and it would be easy to reintroduce by pattern-matching the
    // pair that went out together in August.
    expect(
      FEATURE_CARDS.find((c) => c.title === "Receive"),
      "Receive is on the deck but no receive route exists",
    ).toBeFalsy();
  });

  it("keeps the site and the app agreeing about payments", () => {
    // THE SYMMETRY IS THE POINT, not the direction — which is why this test
    // needed no edit when the direction flipped back on 2026-08-17 and the
    // pay-by-QR entry points were hidden again. It asserts both halves of the
    // disagreement, so it holds whichever way round the pair is set.
    //
    // The live Play listing once shipped a screenshot of a payment tile the
    // app would not open; this is what stops that recurring. The flag has now
    // moved three times, and each move has to carry the site with it.
    const registry = readFileSync(join(ROOT, "src/data/appRegistry.ts"), "utf8");
    const entry = registry.slice(registry.indexOf('id: "oniq-upi"')).slice(0, 400);
    const siteOffers = FEATURE_CARDS.find((c) => c.title === "Scan & Pay")?.status === "live";
    const appHides = /hidden:\s*true/.test(entry);
    expect(
      siteOffers && appHides,
      "the site offers Scan & Pay while oniq-upi is hidden — site and app disagree",
    ).toBe(false);
    expect(
      !siteOffers && !appHides,
      "oniq-upi is visible while the site still defers Scan & Pay — site and app disagree",
    ).toBe(false);
  });
});

describe("Watch is not advertised and Glance is gone — neither is deferred", () => {
  it("no card mentions Watch, live TV or Glance", () => {
    const blob = JSON.stringify(FEATURE_CARDS).toLowerCase();
    expect(blob).not.toMatch(/\bwatch\b/);
    expect(blob).not.toMatch(/\bglance\b/);
    expect(blob).not.toMatch(/live tv|streaming|tv channel/);
  });

  it("records WHY they are absent rather than leaving a silent gap", () => {
    const notes = DELIBERATELY_ABSENT.join(" ").toLowerCase();
    expect(notes).toContain("watch");
    expect(notes).toContain("glance");
    expect(notes).toContain("shop");
    // The Watch note must be TRUE: the surface exists and is not advertised,
    // rather than "removed", which it has not been since 2026-08-16.
    expect(notes).toContain("not advertised");
    expect(notes).not.toMatch(/watch — removed/);
  });

  it("bans the claims a Watch library must never make", () => {
    for (const bad of [
      "download any video",
      "download youtube videos",
      "watch anything for free",
      "free movies from anywhere",
      "access paid content for free",
    ]) {
      expect(BANNED_CLAIMS as readonly string[]).toContain(bad);
    }
  });

  it("no permanent coming-soon card for anything unplanned", () => {
    // A coming-soon card for something nobody intends to build is a promise
    // that is not being kept. Watch exists (India only) and is deliberately
    // not advertised; Glance was dropped. Neither may sit on a "soon" card.
    const soon = FEATURE_CARDS.filter((c) => c.status === "soon").map((c) => c.title.toLowerCase());
    expect(soon).not.toContain("watch");
  });
});

describe("the withheld payment features are withheld everywhere", () => {
  // Scan & Pay is the one where looking-available-but-not is worst. The card
  // says coming soon, so nothing else on the page may imply otherwise — not
  // the worlds grid, not the phone mockup, not the meta description.
  it("the landing page does not present payments as a shipped feature", () => {
    const withoutComments = landing.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(withoutComments).not.toMatch(/label="Pay/);
    expect(withoutComments).not.toMatch(/UPI ready/);
    expect(withoutComments).not.toMatch(/Pay a friend/);
    expect(withoutComments).not.toMatch(/Scan &amp; Pay<\/div>/);
  });

  it("the meta description does not advertise payments", () => {
    expect(root.toLowerCase()).not.toMatch(/chat, pay/);
    expect(landing.toLowerCase()).not.toMatch(/chat, pay/);
  });
});

describe("the Play listing says the same thing as the site", () => {
  it("fits Play's 80-character short description limit", () => {
    expect(PLAY_LISTING.shortDescription.length).toBeLessThanOrEqual(80);
  });

  it("carries no banned claim and no withheld feature", () => {
    const blob = `${PLAY_LISTING.shortDescription} ${PLAY_LISTING.fullDescription}`.toLowerCase();
    for (const bad of BANNED_CLAIMS) {
      expect(blob, `listing contains "${bad}"`).not.toContain(bad);
    }
    expect(blob).not.toMatch(/\bwatch\b|\bglance\b/);
    expect(blob).not.toMatch(/scan & pay|scan and pay|upi qr/);
  });

  it("repeats the true privacy claim, not the false one", () => {
    const blob = PLAY_LISTING.fullDescription.toLowerCase();
    expect(blob).toContain("row-level security");
    expect(blob).not.toMatch(/never leaves your phone.*(health|sleep|mood|cycle)/);
    expect(blob).not.toMatch(/encrypted on your device/);
  });

  it("carries the not-affiliated notice", () => {
    expect(PLAY_LISTING.fullDescription).toMatch(/not affiliated/i);
  });

  it("keeps a screenshot checklist, because screenshots are the stale part", () => {
    const list = PLAY_LISTING.screenshotChecklist.join(" ").toLowerCase();
    for (const must of ["watch", "glance", "scan & pay", "data safety"]) {
      expect(list, `checklist does not mention ${must}`).toContain(must);
    }
  });
});

describe("the landing page renders the copy module, not its own strings", () => {
  it("takes the hero, stats and privacy band from the module", () => {
    for (const token of [
      "HERO.body",
      "WORLDS_LIVE",
      "COUNTRIES_SUPPORTED",
      "SCOUT_LANGUAGES",
      "PRIVACY_BAND",
      "FEATURE_CARDS",
      "NOT_AFFILIATED",
    ]) {
      expect(landing, `landing does not use ${token}`).toContain(token);
    }
  });

  it("renders coming-soon cards as non-links, visibly dimmed and badged", () => {
    expect(landing).toMatch(/Coming soon/);
    expect(landing).toMatch(/opacity-60|opacity-50/);
    // The tile is a <div>, never a <Link> — a soon card must not be tappable.
    const tile = landing.slice(landing.indexOf("function FeatureTile"));
    const body = tile.slice(0, tile.indexOf("\nfunction "));
    expect(body).not.toMatch(/<Link/);
  });

  it("shows the 18+ badge on the card, not only inside the app", () => {
    expect(landing).toMatch(/18\+/);
    expect(FEATURE_CARDS.some((c) => c.adultOnly)).toBe(true);
  });

  it("names the grievance officer and carries the not-affiliated notice", () => {
    expect(landing).toMatch(/GRIEVANCE_OFFICER\.name/);
    expect(NOT_AFFILIATED).toMatch(/not affiliated/i);
  });
});

describe("banned claims appear nowhere public", () => {
  const surfaces: [string, string][] = [
    ["landing", landing],
    ["root meta", root],
    ["copy module", JSON.stringify({ HERO, FEATURE_CARDS, PRIVACY_BAND })],
  ];

  it.each(surfaces)("%s carries no banned claim", (_name, text) => {
    const lower = text.toLowerCase();
    for (const bad of BANNED_CLAIMS) {
      expect(lower, `contains banned claim "${bad}"`).not.toContain(bad);
    }
  });

  it("spells Wanderlust correctly everywhere", () => {
    for (const [, text] of surfaces) {
      expect(text.toLowerCase()).not.toContain("vanderlust");
    }
  });
});

describe("the privacy band is true", () => {
  it("does not claim health data stays on the device", () => {
    // Vitals writes to Postgres. The deck's original wording — "encrypted on
    // your device. Not on our servers." — was false, and this is the guard.
    const band = `${PRIVACY_BAND.heading} ${PRIVACY_BAND.body}`.toLowerCase();
    expect(band).not.toMatch(/never leaves your phone.*(sleep|mood|cycle|health)/);
    expect(band).not.toMatch(/not on our servers/);
    expect(band).not.toMatch(/encrypted on your device/);
  });

  it("claims only the controls that actually exist", () => {
    const band = PRIVACY_BAND.body.toLowerCase();
    expect(band).toContain("row-level security");
    expect(band).toContain("safety plan");
    expect(band).toMatch(/export or delete/);
  });

  it("the safety plan really is the device-only one", () => {
    const plan = readFileSync(join(ROOT, "src/routes/_authenticated/app.safety-plan.tsx"), "utf8");
    expect(plan).toMatch(/localStorage/);
    expect(plan, "safety plan writes to a server table").not.toMatch(
      /supabase[\s\S]{0,40}\.from\(/,
    );
  });
});

describe("the numbers are counted, not inherited", () => {
  it("WORLDS_LIVE equals the live cards", () => {
    expect(WORLDS_LIVE).toBe(FEATURE_CARDS.filter((c) => c.status === "live").length);
  });

  it("the countries figure matches the registry", () => {
    expect(COUNTRIES_SUPPORTED).toBe(ALL_COUNTRIES.length);
  });

  it("no stale hard-coded stat is left on the page", () => {
    expect(landing).not.toMatch(/value="12"/);
    expect(landing).not.toMatch(/Twelve worlds/i);
    expect(landing).not.toMatch(/TV genres/i);
  });

  it("Scout's language count is stated once, in the module", () => {
    expect(SCOUT_LANGUAGES).toBeGreaterThan(0);
  });

  it("the Play description quotes the registry rather than a frozen number", () => {
    // This is the one that got away. SCOUT_LANGUAGES was derived correctly and
    // the landing page used it, but PLAY_LISTING.fullDescription — which is
    // the text pasted into Play Console, read by every user who taps "more" —
    // still said a flat "25 languages" after the registry grew to 56. The
    // earlier guard only forbade the string `"A 25-language`, a different
    // sentence, so it passed while the store listing was wrong.
    expect(PLAY_LISTING.fullDescription).toContain(`${SCOUT_LANGUAGES} languages`);
    const counts = PLAY_LISTING.fullDescription.match(/\b\d+\s+languages\b/g) ?? [];
    for (const claim of counts) {
      expect(claim, `the listing claims "${claim}" but the registry has ${SCOUT_LANGUAGES}`).toBe(
        `${SCOUT_LANGUAGES} languages`,
      );
    }
  });

  it("the Play description states the country count the registry actually has", () => {
    expect(PLAY_LISTING.fullDescription).toContain(`${COUNTRIES_SUPPORTED} countries`);
  });

  it("the Console checklist names the deletion URL that actually exists", () => {
    // The route is real and reachable; the declaration was the missing half.
    const blob = PLAY_LISTING.consoleChecklist.join(" ");
    expect(blob).toContain("https://oniqhub.com/delete-account");
    expect(existsSync(join(process.cwd(), "src/routes/delete-account.tsx"))).toBe(true);
  });

  it("the Console checklist forbids the Financial info declaration", () => {
    expect(PLAY_LISTING.consoleChecklist.join(" ")).toMatch(/NOT declare Financial info/);
  });

  it("nothing in the app collects payment or purchase data", () => {
    // The claim the checklist rests on, asserted rather than assumed. If a
    // billing SDK ever lands, this fails and the Data safety form must change
    // in the same breath.
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    for (const sdk of ["stripe", "razorpay", "braintree", "paypal", "play-billing", "revenuecat"]) {
      expect(deps, `${sdk} is installed — Data safety must declare Financial info`).not.toContain(
        sdk,
      );
    }
  });

  it("the Play description promises no payment, wallet or money surface", () => {
    // Scan & Pay and Receive are held back, oniq-upi carries hidden: true, and
    // the app takes no payment of any kind. Anything here that reads as a
    // money feature drags the listing into Play's financial-services surface
    // and contradicts the Data safety form it should match.
    const desc = PLAY_LISTING.fullDescription.toLowerCase();
    for (const bad of ["scan & pay", "scan and pay", "wallet", "send money", "upi", "payment"]) {
      expect(desc, `the listing promises "${bad}" while the surface is withheld`).not.toContain(
        bad,
      );
    }
  });
});

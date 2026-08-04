/**
 * Pulse: country axis, and the one country where the feed is simply off.
 *
 * The UAE block is not a preference. The 2023/24 Media Law reaches foreign
 * apps serving news into the country, penalties run to AED 1 million, and
 * there is no intermediary safe harbour there. Every other jurisdiction Pulse
 * ships in is a careful call; this one is a hard stop.
 *
 * Also locks the Watch axis, which is a different question with the same
 * shape: Watch must follow where the viewer physically is, never Home, because
 * streaming rights are territorial and the wrong axis makes ONIQ the
 * infringing party.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import {
  NEWS_BLOCKED_COUNTRIES,
  NEWS_POLICY,
  newsFeedAllowed,
  newsUnavailableReason,
} from "@/data/newsPolicy";

const ROOT = process.cwd();

describe("Pulse country policy", () => {
  it("switches the feed OFF in the UAE", () => {
    expect(newsFeedAllowed("AE")).toBe(false);
    expect(NEWS_BLOCKED_COUNTRIES).toContain("AE");
  });

  it("gives the UAE an honest reason rather than an empty screen", () => {
    const reason = newsUnavailableReason("AE");
    expect(reason).toBeTruthy();
    expect(reason!.length).toBeGreaterThan(30);
  });

  it("ships everywhere else", () => {
    for (const c of ALL_COUNTRIES) {
      if (c === "AE") continue;
      expect(newsFeedAllowed(c), `${c} should have a feed`).toBe(true);
    }
  });

  it("covers every supported country, so a new one cannot default in silently", () => {
    for (const c of ALL_COUNTRIES) expect(NEWS_POLICY[c], `${c} has no policy`).toBeDefined();
  });

  it("records why each country ships the way it does", () => {
    for (const c of ALL_COUNTRIES) expect(NEWS_POLICY[c].note.length).toBeGreaterThan(20);
  });

  it("wires Singapore's POFMA correction hook", () => {
    expect(NEWS_POLICY.SG.correctionHook?.url).toContain("pofmaoffice.gov.sg");
  });
});

describe("the block is enforced server-side, not just in the client", () => {
  const fn = readFileSync(join(ROOT, "supabase/functions/news/index.ts"), "utf8");

  it("the edge function refuses AE itself", () => {
    // A client-side check is a rendering decision; anyone can call the
    // function directly.
    expect(fn).toMatch(/FEED_BLOCKED/);
    expect(fn).toMatch(/AE:/);
  });

  it("the two blocklists agree", () => {
    for (const c of NEWS_BLOCKED_COUNTRIES) {
      expect(fn, `${c} blocked in the registry but not in the edge function`).toMatch(
        new RegExp(`${c}:`),
      );
    }
  });

  it("stores no article body — headline, snippet, source and link only", () => {
    expect(fn).not.toMatch(/content:encoded|articleBody|full_text|fullText/);
  });
});

describe("Watch axis stays physical-location specific", () => {
  const watchSrc = readFileSync(join(ROOT, "src/data/watchChannels.ts"), "utf8");
  const player = readFileSync(join(ROOT, "src/components/landing/LiveNewsSection.tsx"), "utf8");

  it("filters on the region argument, never on Home country", () => {
    expect(watchSrc).not.toMatch(/useCountry|homeCountry|\bhome\b\s*\)/);
  });

  it("the player feeds Watch from useCurrentRegion, not useCountry", () => {
    expect(player).toMatch(/useCurrentRegion/);
    const call = player.match(/watchChannelsFor\(([^)]*)\)/);
    expect(call, "watchChannelsFor call not found").toBeTruthy();
    expect(call![1].trim()).toBe("region");
  });

  it("current region is edge-detected and cannot be set from the UI", () => {
    // region.ts derives the country from the Cloudflare edge header only — no
    // GPS, no coordinates, no device-language inference. A user-facing setter
    // would let someone in Dubai claim GB and pull UK streams, which is
    // exactly the territorial hole this axis exists to close.
    const region = readFileSync(join(ROOT, "src/lib/region.ts"), "utf8");
    expect(region).toMatch(/cf-ipcountry/i);
    const callers = readFileSync(
      join(ROOT, "src/components/landing/LiveNewsSection.tsx"),
      "utf8",
    );
    expect(callers).not.toMatch(/setCurrentRegion/);
  });
});

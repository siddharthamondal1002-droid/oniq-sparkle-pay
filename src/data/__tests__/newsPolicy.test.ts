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

describe("Watch axis is still current region — but for relevance now", () => {
  // This block used to assert that Watch's region filter was a TERRITORIAL
  // RIGHTS control: it existed so ONIQ could not serve a stream outside its
  // licensed territory. Watch no longer serves streams, so that justification
  // is gone and the old assertions were checking a property that no longer
  // means anything.
  //
  // The axis itself survives, and is still worth pinning: the directory should
  // show a user standing in Singapore the channels useful to them, and Home
  // country is the wrong signal for that. What changed is the consequence of
  // getting it wrong — a UX miss instead of infringement.
  const watchSrc = readFileSync(join(ROOT, "src/data/watchDirectory.ts"), "utf8");
  const surface = readFileSync(join(ROOT, "src/components/landing/LiveNewsSection.tsx"), "utf8");

  it("filters on the region argument, never on Home country", () => {
    expect(watchSrc).not.toMatch(/useCountry|homeCountry/);
  });

  it("the Watch surface feeds the directory from useCurrentRegion", () => {
    expect(surface).toMatch(/useCurrentRegion/);
    const call = surface.match(/watchDirectoryFor\(([^,)]*)/);
    expect(call, "watchDirectoryFor call not found").toBeTruthy();
    expect(call![1].trim()).toBe("region");
  });

  it("current region is still edge-detected and not settable from the UI", () => {
    // region.ts derives the country from the Cloudflare edge header only — no
    // GPS, no coordinates, no device-language inference. That constraint is
    // about location privacy, which did not change when the streams went away.
    const region = readFileSync(join(ROOT, "src/lib/region.ts"), "utf8");
    expect(region).toMatch(/cf-ipcountry/i);
    expect(surface).not.toMatch(/setCurrentRegion/);
  });

  it("says in the source that the gate is no longer a legal control", () => {
    // Guard against someone re-adding a fail-closed rights gate that now
    // protects nothing, or deleting the filter thinking it was cosmetic.
    expect(watchSrc).toMatch(/RELEVANCE ONLY/);
  });
});

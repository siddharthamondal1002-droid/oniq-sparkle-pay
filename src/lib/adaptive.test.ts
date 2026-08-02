import { describe, expect, it } from "vitest";
import { pickSuggestion, type Signal } from "@/lib/adaptive";

const NOW = new Date("2026-08-05T19:00:00"); // Wednesday, 19:00 local

let n = 0;
const sig = (p: Partial<Signal>): Signal => ({
  id: `s${n++}`,
  kind: "hub_open",
  hub: "study",
  city: null,
  dow: 3,
  hour: 19,
  created_at: NOW.toISOString(),
  ...p,
});

describe("pickSuggestion", () => {
  it("stays silent with no signals", () => {
    expect(pickSuggestion([], NOW)).toBeNull();
  });

  it("stays silent below the repetition threshold", () => {
    expect(pickSuggestion([sig({}), sig({})], NOW)).toBeNull();
  });

  it("fires after three hits in the same band, with a reason", () => {
    const s = pickSuggestion([sig({}), sig({ hour: 18 }), sig({ hour: 20 })], NOW);
    expect(s?.hub).toBe("study");
    expect(s?.to).toBe("/app/study");
    expect(s?.reason).toMatch(/opened .* 3 times around this hour on weekdays/);
  });

  it("ignores hits from a different hour band or weekend/weekday", () => {
    const s = pickSuggestion(
      [sig({ hour: 8 }), sig({ hour: 12 }), sig({ dow: 6 })],
      NOW,
    );
    expect(s).toBeNull();
  });

  it("goes quiet for the cooldown after one dismiss", () => {
    const base = [sig({}), sig({ hour: 18 }), sig({ hour: 20 })];
    const recent = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    expect(pickSuggestion([...base, sig({ kind: "card_dismiss", created_at: recent })], NOW)).toBeNull();
  });

  it("may suggest again once the cooldown has passed", () => {
    const base = [sig({}), sig({ hour: 18 }), sig({ hour: 20 })];
    const old = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    expect(pickSuggestion([...base, sig({ kind: "card_dismiss", created_at: old })], NOW)?.hub).toBe("study");
  });

  it("retires a hub permanently after two dismisses", () => {
    const base = [sig({}), sig({ hour: 18 }), sig({ hour: 20 })];
    const old = new Date(NOW.getTime() - 300 * 86_400_000).toISOString();
    const s = pickSuggestion(
      [
        ...base,
        sig({ kind: "card_dismiss", created_at: old }),
        sig({ kind: "card_dismiss", created_at: old }),
      ],
      NOW,
    );
    expect(s).toBeNull();
  });

  it("never suggests a hub outside the allow-list", () => {
    const s = pickSuggestion(
      [sig({ hub: "wallet" }), sig({ hub: "wallet" }), sig({ hub: "wallet" })],
      NOW,
    );
    expect(s).toBeNull();
  });

  it("returns at most one suggestion, the most repeated", () => {
    const s = pickSuggestion(
      [
        sig({}), sig({}), sig({}), sig({}),
        sig({ hub: "faith" }), sig({ hub: "faith" }), sig({ hub: "faith" }),
      ],
      NOW,
    );
    expect(s?.hub).toBe("study");
  });
});

/**
 * Motion TRANSFER: a driver supplies movement, the ONIQ still supplies identity.
 * Proven end-to-end through the contract with a MOCK backend — no GPU, no spend,
 * no driver video generated. A real walking clip waits on a GPU host.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MOTION_MIRROR_META,
  WAN22_META,
  classifyMotionDriver,
  makeMotionTransferProvider,
  mockBackend,
  runMotion,
  selectMotionDriver,
  selectProviderOrder,
  type MotionDriver,
  type MotionProvider,
  type MotionRequest,
} from "@/lib/motionProvider";

// The committed walk fixture descriptor, loaded as the driver registry would be.
const WALK_FIXTURE: MotionDriver = JSON.parse(
  readFileSync(
    join(process.cwd(), "remotion/fixtures/motion-drivers/walk_9x16.driver.json"),
    "utf8",
  ),
);
const REGISTRY: MotionDriver[] = [WALK_FIXTURE];

describe("classifyMotionDriver — the shot's own words choose the movement", () => {
  it("maps the owner's examples to drivers", () => {
    const cases: [string, string][] = [
      ["walks through the market", "WALK"],
      ["runs toward the door", "RUN"],
      ["waves at her friend", "WAVE"],
      ["turns and looks behind her", "TURN"],
      ["sits on the chair", "SIT"],
      ["stands up", "STAND"],
      ["points toward the shop", "POINT"],
    ];
    for (const [motion, want] of cases) {
      expect(classifyMotionDriver({ motion }), motion).toBe(want);
    }
    // A spoken line is a TALK driver.
    expect(classifyMotionDriver({ dialogue: { line: "Fresh fish!" } })).toBe("TALK");
    expect(classifyMotionDriver({ motion: "speaks to the fish seller" })).toBe("TALK");
  });

  it("returns null for still-only shots (no driver)", () => {
    expect(classifyMotionDriver({ motion: "Slow push in across the market" })).toBeNull();
    expect(classifyMotionDriver({})).toBeNull();
  });
});

describe("the walk fixture is a valid, identity-free driver descriptor", () => {
  it("declares WALK, 9:16, and carries provenance + license fields", () => {
    expect(WALK_FIXTURE.motionClass).toBe("WALK");
    expect(WALK_FIXTURE.aspectRatio).toBe("9:16");
    expect(WALK_FIXTURE.source).toMatch(/movement only|no identity|PLACEHOLDER/i);
    expect(WALK_FIXTURE).toHaveProperty("license");
    expect(selectMotionDriver("WALK", REGISTRY)?.id).toBe("walk_9x16");
    expect(selectMotionDriver("DANCE", REGISTRY)).toBeNull();
  });
});

describe("ONE WALKING SHOT (mock): different character, driver movement", () => {
  it("Bengali-woman still + WALK driver → MotionClip via motion transfer", async () => {
    // The character (a middle-aged Bengali woman at a Jamaican fish market) is
    // ENTIRELY different from whatever the driver depicts — the still is the
    // identity, the driver is only the walk.
    const provider = makeMotionTransferProvider(mockBackend(), REGISTRY);
    const req: MotionRequest = {
      sourceStillBase64: "BENGALI_WOMAN_STILL",
      sourceMime: "image/png",
      motionPrompt: "She walks naturally through the fish market.",
      durationSeconds: 8,
      aspectRatio: "9:16",
      motionClass: "WALKING",
      driverClass: "WALK",
    };
    const order = selectProviderOrder("WALKING", [provider], { allowPremium: false });
    expect(order.map((p) => p.meta.role)).toEqual(["motion-transfer"]);
    const { clip } = await runMotion(req, order);
    expect(clip && clip.ok).toBe(true);
    expect(clip).toMatchObject({
      ok: true,
      mime: "video/mp4",
      seconds: 8,
      provider: MOTION_MIRROR_META.name,
    });
    // Honest: the mock returns a sentinel, NOT real pixels — no "walks" claim.
    expect((clip as { data: string }).data).toMatch(/^MOCK_MOTION_TRANSFER:walk_9x16/);
  });

  it("no matching driver → transfer misses, runMotion falls to the i2v provider", async () => {
    const transfer = makeMotionTransferProvider(mockBackend(), REGISTRY); // only WALK
    const i2v: MotionProvider = {
      meta: WAN22_META,
      available: () => true,
      generate: async () => ({ ok: true, data: "WANBYTES", mime: "video/mp4", seconds: 6, provider: WAN22_META.name }),
    };
    const req: MotionRequest = {
      sourceStillBase64: "S",
      sourceMime: "image/png",
      motionPrompt: "They fight in the alley.",
      durationSeconds: 6,
      aspectRatio: "9:16",
      motionClass: "INTERACTION",
      driverClass: "FIGHT", // no FIGHT driver in the registry
    };
    // INTERACTION prefers i2v first anyway; either way the transfer miss is safe.
    const order = selectProviderOrder("INTERACTION", [transfer, i2v], { allowPremium: false });
    const { clip } = await runMotion(req, order);
    expect(clip).toMatchObject({ ok: true, provider: WAN22_META.name });
  });
});

describe("provider order — transfer leads ordinary action, i2v leads complex", () => {
  it("WALKING → [motion-transfer, i2v]; INTERACTION → [i2v, motion-transfer]", () => {
    const transfer = makeMotionTransferProvider(mockBackend(), REGISTRY);
    const i2v: MotionProvider = { meta: WAN22_META, available: () => true, generate: async () => ({ ok: false, reason: "x", provider: "w", class: "transient" }) };
    expect(selectProviderOrder("WALKING", [i2v, transfer], { allowPremium: false }).map((p) => p.meta.role)).toEqual([
      "motion-transfer",
      "i2v",
    ]);
    expect(selectProviderOrder("INTERACTION", [transfer, i2v], { allowPremium: false }).map((p) => p.meta.role)).toEqual([
      "i2v",
      "motion-transfer",
    ]);
  });
});

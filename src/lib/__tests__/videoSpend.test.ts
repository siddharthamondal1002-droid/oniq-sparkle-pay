/**
 * VIDEO: audio architecture, routing, and the financial invariants.
 *
 * The eleven the owner named, in their words:
 *   NO BILLABLE VIDEO WITHOUT RESERVATION
 *   NO UNKNOWN COST BECOMES ZERO
 *   NO UNPRICED MODEL CAN GENERATE
 *   NO UNBOUNDED RETRY
 *   NO SILENT FAST ESCALATION
 *   NO RUNWAY SELECTION WHILE UNVERIFIED
 *   NO UNNECESSARY VEO AUDIO
 *   NO PROVIDER AUDIO GENERATED THEN DISCARDED
 *   NATIVE AUDIO IS PRESERVED WHEN REQUESTED
 *   FAILED OUTPUT DOES NOT CHARGE USER
 *   DUPLICATE REQUEST CANNOT DOUBLE-SPEND
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type Capability,
  refusalMessage,
  requestIdFrom,
  withProviderSpendGuard,
} from "../../../supabase/functions/_shared/financialLedger.ts";
import {
  AI_STUDIO_REJECTED_VIDEO_PARAMS,
  AV_DRIFT_TOLERANCE_S,
  type AudioMode,
  inferAudioMode,
  planShotAudio,
  resolveAudioMode,
  SURFACE_SUPPORTS_AUDIO_PARAM,
  verifyFinalMedia,
} from "../../../supabase/functions/_shared/videoAudio.ts";
import {
  ACTIVE_VIDEO_SURFACE,
  chooseTier,
  classifyVideoFailure,
  escalationFor,
  FILTERED_OUTPUT_BILLING,
  filteredCostBounds,
  findRate,
  VIDEO_RATES,
  videoUsd,
} from "../../../supabase/functions/_shared/videoRouting.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** Comments describe code; they are not code. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

const FAST = "veo-3.1-fast-generate-preview";
const LITE = "veo-3.1-lite-generate-preview";

function fakeRpc(admit: Record<string, unknown>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "admit_provider_spend") return { data: admit, error: null };
    return { data: { ok: true }, error: null };
  };
  return { rpc, calls };
}
const ADMITTED = { ok: true, reason: "admitted", attempt: 1 };

const VIDEO_REQ = {
  requestId: "clip-1",
  capability: "VIDEO" as Capability,
  provider: "google",
  model: FAST,
  unit: "video_seconds_with_audio" as const,
  units: 8,
  estimatedUsd: 0.8,
  jobId: "shot-1",
};

// ============================================================ audio surface
describe("the audio parameter, verified against Google's own SDK", () => {
  it("records that the Gemini Developer API cannot be told to skip audio", () => {
    expect(SURFACE_SUPPORTS_AUDIO_PARAM["google-ai-studio"]).toBe(false);
    expect(SURFACE_SUPPORTS_AUDIO_PARAM["google-agent-platform"]).toBe(true);
    expect(AI_STUDIO_REJECTED_VIDEO_PARAMS).toContain("generateAudio");
  });

  it("is the surface story-clip actually calls", () => {
    expect(ACTIVE_VIDEO_SURFACE).toBe("google-ai-studio");
    expect(read("supabase/functions/story-clip/index.ts")).toMatch(
      /generativelanguage\.googleapis\.com/,
    );
  });

  it("NEVER sends generateAudio on that surface", () => {
    // Not a style point: the API rejects it, and story-clip's strip-on-400
    // ladder would silently drop it while the caller believed it had opted out.
    // Comments are stripped — the file explains at length why the parameter is
    // absent, and that explanation is not a call.
    expect(code("supabase/functions/story-clip/index.ts")).not.toMatch(/generateAudio/);
  });
});

// ============================================================ audio modes
describe("NO PROVIDER AUDIO GENERATED THEN DISCARDED", () => {
  it("a discard always carries a reason — silence about it is the thing banned", () => {
    for (const mode of ["VIDEO_ONLY", "ONIQ_SOUND"] as AudioMode[]) {
      const r = resolveAudioMode(mode, "google-ai-studio");
      expect(r.providerAudioBilled, mode).toBe(true);
      expect(r.preserveProviderAudio, mode).toBe(false);
      expect(r.discardReason, mode).toBeTruthy();
      expect(r.discardReason!.length, mode).toBeGreaterThan(20);
    }
  });

  it("reports VIDEO_ONLY as NOT achievable here, so nobody thinks they bought the cheap tier", () => {
    expect(resolveAudioMode("VIDEO_ONLY", "google-ai-studio").achievable).toBe(false);
    // On a surface that can be told, it is achievable and nothing is billed.
    const vertex = resolveAudioMode("VIDEO_ONLY", "google-agent-platform");
    expect(vertex.achievable).toBe(true);
    expect(vertex.providerAudioBilled).toBe(false);
    expect(vertex.discardReason).toBeUndefined();
  });

  it("NATIVE AUDIO IS PRESERVED WHEN REQUESTED, on both surfaces", () => {
    for (const surface of ["google-ai-studio", "google-agent-platform"] as const) {
      const r = resolveAudioMode("VEO_NATIVE_AUDIO", surface);
      expect(r.preserveProviderAudio, surface).toBe(true);
      expect(r.discardReason, surface).toBeUndefined();
    }
  });

  it("the renderer keeps the track when the shot says to", () => {
    const film = read("remotion/src/story/StoryFilm.tsx");
    expect(film).toMatch(/muted=\{!shot\.clip\.preserveAudio\}/);
    // The frozen tail is one held frame; running its audio would replay the
    // clip's sound under a still image.
    expect(film).toMatch(/<Freeze[\s\S]{0,200}muted\s/);
  });
});

describe("NO UNNECESSARY VEO AUDIO — the story-aware router", () => {
  const base = {
    hasNarration: false,
    hasOniqDialogue: false,
    hasOniqAmbience: false,
    promptText: "",
  };

  it("never lets a provider voice collide with ONIQ's own", () => {
    expect(
      inferAudioMode({ ...base, hasNarration: true, promptText: 'he says "don\'t leave me"' }).mode,
    ).toBe("ONIQ_SOUND");
    expect(inferAudioMode({ ...base, hasOniqDialogue: true, promptText: "explosion" }).mode).toBe(
      "ONIQ_SOUND",
    );
  });

  it("routes the owner's worked examples", () => {
    const cases: Array<[string, AudioMode, Partial<typeof base>]> = [
      ["a silent cinematic shot of the empty street", "VIDEO_ONLY", {}],
      ['a man says "Don\'t leave me"', "VEO_NATIVE_AUDIO", {}],
      ["an explosion with synchronised sound", "VEO_NATIVE_AUDIO", {}],
      ["a woman walking through rain", "VEO_NATIVE_AUDIO", {}],
      ["a woman walking through rain", "ONIQ_SOUND", { hasOniqAmbience: true }],
      ["montage of the city", "ONIQ_SOUND", { hasNarration: true }],
    ];
    for (const [promptText, expected, extra] of cases) {
      const r = inferAudioMode({ ...base, ...extra, promptText });
      expect(r.mode, `${promptText} ${JSON.stringify(extra)}`).toBe(expected);
      expect(r.because.length).toBeGreaterThan(10);
    }
  });

  it("is not silent-by-default and not native-by-default", () => {
    const modes = new Set(
      [
        "a wide of the mountain",
        'she asks "where?"',
        "footsteps on gravel",
        "a silent portrait",
      ].map((promptText) => inferAudioMode({ ...base, promptText }).mode),
    );
    expect(modes.size).toBeGreaterThan(1);
  });

  it("planShotAudio hands the ledger a decision AND its reason", () => {
    const p = planShotAudio({ ...base, hasNarration: true }, ACTIVE_VIDEO_SURFACE);
    expect(p.effective).toBe("ONIQ_SOUND");
    expect(p.because).toBeTruthy();
    expect(p.discardReason).toBeTruthy();
  });
});

// ============================================================ pricing
describe("NO UNPRICED MODEL CAN GENERATE", () => {
  it("throws for a model with no rate on this surface", () => {
    expect(() => videoUsd("veo-9-imaginary", 8, "ONIQ_SOUND")).toThrow(/no rate/);
  });

  it("throws for Runway, whose credit price nobody has verified", () => {
    expect(() => videoUsd("gen4_turbo", 8, "ONIQ_SOUND", "runway")).toThrow(/unverified/);
  });

  it("bills the WITH-AUDIO rate on a surface that cannot decline audio", () => {
    // The trap this closes: reserving $0.03/s for a call Google bills at $0.05.
    expect(videoUsd(LITE, 8, "VIDEO_ONLY")).toBeCloseTo(0.4, 6);
    expect(videoUsd(LITE, 8, "VEO_NATIVE_AUDIO")).toBeCloseTo(0.4, 6);
    expect(videoUsd(FAST, 8, "ONIQ_SOUND")).toBeCloseTo(0.8, 6);
  });

  it("uses the cheaper video-only rate where it is actually reachable", () => {
    expect(videoUsd("veo-3.1-lite", 8, "VIDEO_ONLY", "google-agent-platform")).toBeCloseTo(0.24, 6);
    expect(videoUsd("veo-3.1-fast", 8, "VIDEO_ONLY", "google-agent-platform")).toBeCloseTo(0.64, 6);
  });

  it("records the video-only column as UNREACHABLE here rather than omitting it", () => {
    for (const m of [LITE, FAST]) {
      const r = findRate(m)!;
      expect(r.usdPerSecondVideoOnly, m).toBeNull();
      expect(r.usdPerSecondWithAudio, m).toBeGreaterThan(0);
    }
  });

  it("every rate carries its provenance", () => {
    for (const r of VIDEO_RATES) {
      expect(r.provenance, r.model).toBeTruthy();
      if (r.provenance === "UNVERIFIED") {
        expect(r.usdPerSecondWithAudio, r.model).toBeNull();
      }
    }
  });

  it("refuses a zero or negative duration instead of pricing it at nothing", () => {
    expect(() => videoUsd(FAST, 0, "ONIQ_SOUND")).toThrow();
    expect(() => videoUsd(FAST, -8, "ONIQ_SOUND")).toThrow();
  });
});

describe("FILTERED OUTPUT — never treated as free", () => {
  it("is recorded as UNKNOWN, not assumed", () => {
    expect(FILTERED_OUTPUT_BILLING).toBe("UNKNOWN");
  });

  it("computes both bounds, and the conservative one is not zero", () => {
    const b = filteredCostBounds(FAST, 8, 2);
    expect(b.lowerBoundUsd).toBe(0);
    expect(b.conservativeUsd).toBeCloseTo(1.6, 6);
  });

  it("story-clip settles a filtered generation rather than releasing it", () => {
    const src = read("supabase/functions/story-clip/index.ts");
    expect(src).toMatch(/settle\("FILTERED"/);
    // A release would be inventing a refund for a generation that ran.
    expect(src).not.toMatch(/releaseProviderSpend/);
  });
});

// ============================================================ escalation
describe("NO SILENT FAST ESCALATION", () => {
  it("escalates for motion complexity and nothing else", () => {
    const classes = [
      "MOTION_COMPLEXITY",
      "CONTENT_FILTERED",
      "BAD_PROMPT",
      "BAD_REFERENCE",
      "PROVIDER_OUTAGE",
      "QUOTA_EXHAUSTED",
      "BUDGET",
      "UNKNOWN",
    ] as const;
    const escalating = classes.filter((c) => escalationFor(c).action === "ESCALATE_TIER");
    expect(escalating).toEqual(["MOTION_COMPLEXITY"]);
  });

  it("does NOT escalate a responsible-AI refusal — measured: both tiers refused", () => {
    const a = escalationFor("CONTENT_FILTERED");
    expect(a.action).toBe("FIX_PROMPT");
    expect(a.because).toMatch(/refus/i);
  });

  it("stops rather than paying a third time when the other tier already failed", () => {
    expect(escalationFor("MOTION_COMPLEXITY", { failedOnOtherTier: true }).action).toBe("STOP");
  });

  it("classifies the shapes the provider actually returns", () => {
    expect(classifyVideoFailure({ httpStatus: 429, detail: "RESOURCE_EXHAUSTED" })).toBe(
      "QUOTA_EXHAUSTED",
    );
    expect(classifyVideoFailure({ emptyOutput: true })).toBe("CONTENT_FILTERED");
    expect(classifyVideoFailure({ detail: "third-party content" })).toBe("CONTENT_FILTERED");
    expect(classifyVideoFailure({ httpStatus: 503 })).toBe("PROVIDER_OUTAGE");
    expect(classifyVideoFailure({ qaFailure: "ADHERENCE" })).toBe("MOTION_COMPLEXITY");
  });

  it("a quota wall stops rather than backing off — a daily cap does not clear", () => {
    expect(escalationFor("QUOTA_EXHAUSTED").action).toBe("STOP");
  });
});

/** Every precondition satisfied, so the tests below isolate the QUALITY half. */
const OPEN_GATE = {
  generationAllowed: true,
  spendCapsConfigured: true,
  providerAvailable: true,
};

describe("NO RUNWAY SELECTION WHILE UNVERIFIED", () => {
  it("is never chosen, even when both Google tiers miss the bar", () => {
    const c = chooseTier(
      {
        motionClass: "walking",
        liteAcceptance: 0.1,
        fastAcceptance: 0.2,
        blind: false,
        benchmarkId: "v2",
      },
      0.65,
      OPEN_GATE,
    );
    expect(c.tier).toBeNull();
    expect(c.reason).toMatch(/runway is unverified/i);
  });

  it("refuses to choose anything at all without measured evidence", () => {
    expect(chooseTier(null, 0.65).tier).toBeNull();
    expect(
      chooseTier(
        {
          motionClass: "walking",
          liteAcceptance: null,
          fastAcceptance: null,
          blind: false,
          benchmarkId: "v2",
        },
        0.65,
      ).tier,
    ).toBeNull();
  });

  it("prefers the cheaper tier when it clears the bar, and only then escalates", () => {
    const ev = { motionClass: "walking", blind: false, benchmarkId: "v3" };
    expect(
      chooseTier({ ...ev, liteAcceptance: 0.7, fastAcceptance: 0.9 }, 0.65, OPEN_GATE).tier,
    ).toBe("LITE");
    expect(
      chooseTier({ ...ev, liteAcceptance: 0.4, fastAcceptance: 0.9 }, 0.65, OPEN_GATE).tier,
    ).toBe("FAST");
  });
});

// ============================================================ the ledger
describe("NO BILLABLE VIDEO WITHOUT RESERVATION", () => {
  it("story-clip reserves before it submits", () => {
    const src = read("supabase/functions/story-clip/index.ts");
    const admit = src.indexOf("admitProviderSpend");
    const submit = src.indexOf("await submit(model, params)");
    expect(admit).toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(-1);
    expect(admit).toBeLessThan(submit);
  });

  it("refuses outright when the ledger cannot be reached", async () => {
    const run = vi.fn(async () => ({ value: "clip" }));
    const r = await withProviderSpendGuard(null, VIDEO_REQ, run);
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe("guard-unavailable");
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a zero reservation — an unpriced clip is not a free clip", async () => {
    const run = vi.fn(async () => ({ value: "clip" }));
    const { rpc } = fakeRpc(ADMITTED);
    const r = await withProviderSpendGuard(rpc, { ...VIDEO_REQ, estimatedUsd: 0 }, run);
    expect(r.admitted).toBe(false);
    if (!r.admitted) expect(r.reason).toBe("zero-estimate");
    expect(run).not.toHaveBeenCalled();
  });

  it("passes the job id through, so retries are bounded per shot", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withProviderSpendGuard(rpc, VIDEO_REQ, async () => ({ value: 1, outcome: "ACCEPTED" }));
    expect(calls[0].args._job_id).toBe("shot-1");
    expect(calls[0].args._capability).toBe("VIDEO");
    expect(calls[0].args._unit).toBe("video_seconds_with_audio");
    expect(calls[0].args._units).toBe(8);
  });
});

describe("NO UNKNOWN COST BECOMES ZERO (video)", () => {
  it("settles at the measured cost when it is known", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withProviderSpendGuard(rpc, VIDEO_REQ, async () => ({
      value: "clip",
      actualUsd: videoUsd(FAST, 8, "VEO_NATIVE_AUDIO"),
      unitsActual: 8,
      outcome: "ACCEPTED",
    }));
    const settle = calls.find((c) => c.fn === "settle_provider_spend")!;
    expect(settle.args._actual_usd).toBeCloseTo(0.8, 6);
    expect(settle.args._units_actual).toBe(8);
    expect(settle.args._outcome).toBe("ACCEPTED");
  });

  it("leaves actual NULL — never 0 — when the provider reported nothing", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withProviderSpendGuard(rpc, VIDEO_REQ, async () => ({
      value: "failed",
      outcome: "FILTERED",
    }));
    const settle = calls.find((c) => c.fn === "settle_provider_spend")!;
    expect(settle.args._actual_usd).toBeNull();
    expect(settle.args._outcome).toBe("FILTERED");
    expect(calls.some((c) => c.fn === "release_provider_spend")).toBe(false);
  });

  it("defaults an unstated outcome to FAILED, the conservative reading", async () => {
    const { rpc, calls } = fakeRpc(ADMITTED);
    await withProviderSpendGuard(rpc, VIDEO_REQ, async () => ({ value: "?" }));
    expect(calls.find((c) => c.fn === "settle_provider_spend")!.args._outcome).toBe("FAILED");
  });
});

describe("DUPLICATE REQUEST CANNOT DOUBLE-SPEND", () => {
  it("propagates the ledger's refusal and never calls the provider", async () => {
    const run = vi.fn(async () => ({ value: "clip" }));
    const { rpc } = fakeRpc({ ok: false, reason: "duplicate-request" });
    const r = await withProviderSpendGuard(rpc, VIDEO_REQ, run);
    expect(r.admitted).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("a client-supplied id is honoured because reusing one is refused", () => {
    expect(requestIdFrom("shot-1-attempt-2")).toBe("shot-1-attempt-2");
    expect(requestIdFrom("../etc")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("NO UNBOUNDED RETRY", () => {
  it("the ceiling lives in the database, not in a caller's loop", () => {
    const sql = read("supabase/migrations/20260824120000_provider_spend_ledger.sql");
    expect(sql).toMatch(/job-attempts-exhausted/);
    expect(sql).toMatch(/attempts\s*=\s*attempts \+ 1/);
    // A released reservation does NOT hand the attempt back — otherwise a
    // never-called retry loop is unbounded by construction.
    const release = sql.slice(sql.indexOf("function public.release_provider_spend"));
    expect(release.slice(0, 1200)).not.toMatch(/attempts\s*=\s*attempts\s*-\s*1/);
  });

  it("surfaces the exhausted-attempts refusal as a distinct, non-retryable reason", () => {
    expect(refusalMessage("job-attempts-exhausted")).toMatch(/several tries/);
    expect(refusalMessage("job-cap-reached")).not.toBe(refusalMessage("daily-cap-reached"));
  });
});

// ============================================================ media checks
describe("acceptance is decided on the MEDIA, not on the request", () => {
  const ok = { hasVideoStream: true, videoSeconds: 8, hasAudioStream: true, audioSeconds: 8 };

  it("VIDEO_ONLY must have no audio track", () => {
    expect(
      verifyFinalMedia("VIDEO_ONLY", { ...ok, hasAudioStream: false, audioSeconds: 0 }).ok,
    ).toBe(true);
    expect(verifyFinalMedia("VIDEO_ONLY", ok).ok).toBe(false);
  });

  it("the other two modes must have audio that is not silence", () => {
    for (const mode of ["ONIQ_SOUND", "VEO_NATIVE_AUDIO"] as AudioMode[]) {
      expect(verifyFinalMedia(mode, ok).ok, mode).toBe(true);
      expect(
        verifyFinalMedia(mode, { ...ok, hasAudioStream: false, audioSeconds: 0 }).ok,
        mode,
      ).toBe(false);
      // A track present at -91 dB is silence with extra steps — ep1 shipped
      // exactly that once.
      const quiet = verifyFinalMedia(mode, { ...ok, audioPeakDb: -91 });
      expect(quiet.ok, mode).toBe(false);
      expect(quiet.failures.join(" ")).toMatch(/silent/);
    }
  });

  it("catches audio/video drift", () => {
    const drift = verifyFinalMedia("VEO_NATIVE_AUDIO", {
      ...ok,
      audioSeconds: 8 + AV_DRIFT_TOLERANCE_S + 0.1,
    });
    expect(drift.ok).toBe(false);
    expect(drift.failures.join(" ")).toMatch(/drift/);
  });

  it("a missing video stream fails every mode", () => {
    for (const mode of ["VIDEO_ONLY", "ONIQ_SOUND", "VEO_NATIVE_AUDIO"] as AudioMode[]) {
      expect(verifyFinalMedia(mode, { ...ok, hasVideoStream: false }).ok, mode).toBe(false);
    }
  });
});

// ============================================================ separation
describe("SEARCH MUST REMAIN SEPARATE", () => {
  it("no search function can reach a video model or the video ledger capability", () => {
    for (const f of ["smart-scout", "hotel-scout", "ting", "health-scan"]) {
      const src = read(`supabase/functions/${f}/index.ts`);
      expect(src, f).not.toMatch(/veo-|predictLongRunning|story-clip|runwayml|generateVideo/i);
      expect(src, f).not.toMatch(/capability:\s*"VIDEO"/);
    }
  });

  it("story-clip declares the VIDEO capability and never SEARCH", () => {
    const src = read("supabase/functions/story-clip/index.ts");
    expect(src).toMatch(/capability:\s*"VIDEO"/);
    expect(src).not.toMatch(/web_search_/);
  });
});

// ============================================================ no activation
describe("NO PRODUCTION ACTIVATION YET", () => {
  it("generation is OFF by schema default — enabled must be turned on deliberately", () => {
    const sql = read("supabase/migrations/20260824120000_provider_spend_ledger.sql");
    expect(sql).toMatch(/enabled\s+boolean\s+not null default false/);
  });

  it("no capability row is seeded, so nothing can spend on a fresh database", () => {
    const sql = read("supabase/migrations/20260824120000_provider_spend_ledger.sql");
    expect(sql).not.toMatch(/insert into public\.provider_budget_config/);
  });

  it("the movie price tiers stay inactive — this loop prices nothing", () => {
    // storyCostModel is the only thing that justifies a published price, and
    // no video rate from videoRouting has been wired into it. Comments are
    // stripped — the chart names those modules to explain the boundary it must
    // not cross, and explaining a boundary is not crossing it.
    expect(code("src/lib/storyCostModel.ts")).not.toMatch(/videoRouting|usdPerSecondWithAudio/);
  });
});

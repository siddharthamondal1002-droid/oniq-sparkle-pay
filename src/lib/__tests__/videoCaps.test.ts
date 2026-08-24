/**
 * THE THREE VIDEO CAPS — and they are SPEND CEILINGS, not motion thresholds.
 *
 *   VIDEO_CAP_1 = request_usd_cap
 *   VIDEO_CAP_2 = job_usd_cap
 *   VIDEO_CAP_3 = daily_usd_cap
 *
 * `max_attempts_per_job` is a fourth control and it is NOT money: releasing a
 * reservation returns dollars and never returns an attempt, which is the only
 * thing standing between a failing shot and an unbounded retry loop.
 *
 * This file also guards the float-precision class that financial code invites:
 * `0.1 * 3 === 0.30000000000000004` would be REFUSED against a $0.30 ceiling it
 * exactly equals.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  roundUsd,
  USD_DECIMALS,
  validateBudgetCaps,
  providerBudgetStatus,
} from "../../../supabase/functions/_shared/financialLedger.ts";
import {
  chooseTier,
  usdPerAttempt,
  videoUsd,
  compareGoogleSurfaces,
} from "../../../supabase/functions/_shared/videoRouting.ts";
import {
  GeminiDeveloperApiProvider,
  GoogleAgentPlatformProvider,
  providerConfigStatus,
  providerForSurface,
} from "../../../supabase/functions/_shared/videoProvider.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const LEDGER_SQL = read("supabase/migrations/20260824120000_provider_spend_ledger.sql");
const INVARIANTS_SQL = read("supabase/migrations/20260824150000_provider_budget_invariants.sql");
const CEILINGS_SQL = read("supabase/migrations/20260824170000_video_spend_ceilings.sql");

/**
 * THE OWNER'S THREE NUMBERS — directive of 2026-08-24.
 *
 * Mirrored here so drift in either direction fails the build: a migration
 * edited away from what the owner authorised, or a test quietly re-pointed at
 * whatever the migration happens to say.
 */
const OWNER_CAPS = { request: "1.00", job: "5.00", daily: "50.00" } as const;

const VALID = { requestUsdCap: 1, jobUsdCap: 2, dailyUsdCap: 5, maxAttemptsPerJob: 3 };

// ============================================================ cap identity
describe("the three VIDEO caps are spend ceilings", () => {
  it("names them exactly, and they all exist in the schema", () => {
    for (const cap of ["request_usd_cap", "job_usd_cap", "daily_usd_cap"]) {
      expect(LEDGER_SQL, cap).toMatch(new RegExp(`${cap}\\s+numeric`));
    }
    expect(LEDGER_SQL).toMatch(/max_attempts_per_job\s+integer/);
  });

  it("does NOT invent VIDEO_CAP_1/2/3 as motion-class thresholds", () => {
    // The previous loop stopped because these were not repository concepts. The
    // correction is that they are spend caps — so nothing may define them as
    // acceptance bars, and no benchmark may be built around them.
    for (const f of [
      "supabase/functions/_shared/videoRouting.ts",
      "supabase/functions/_shared/videoAudio.ts",
      "supabase/functions/_shared/videoProvider.ts",
      "supabase/functions/_shared/financialLedger.ts",
    ]) {
      expect(read(f), f).not.toMatch(/VIDEO_CAP_[123]/);
    }
    expect(INVARIANTS_SQL).not.toMatch(/VIDEO_CAP_[123]/);
  });

  it("keeps the repository's seven motion classes, and invents no three", () => {
    const src = read("src/lib/motionProvider.ts");
    for (const cls of [
      "STATIC",
      "CAMERA_ONLY",
      "CHARACTER_MOTION",
      "WALKING",
      "TALKING",
      "GESTURE",
      "INTERACTION",
    ]) {
      expect(src, cls).toMatch(new RegExp(`"${cls}"`));
    }
    // The one liveness floor stays a liveness floor.
    expect(read("src/lib/motionRuntime.ts")).toMatch(/CLIP_ALIVENESS_MIN = 0\.75/);
  });
});

// ============================================================ configuration
describe("cap configuration is validated, never normalised", () => {
  it("accepts a well-ordered triple", () => {
    expect(validateBudgetCaps(VALID).valid).toBe(true);
    // Equality is legal at every step: <=, not <.
    expect(validateBudgetCaps({ requestUsdCap: 1, jobUsdCap: 1, dailyUsdCap: 1 }).valid).toBe(true);
  });

  it("rejects every invalid shape the owner listed", () => {
    const bad: Array<[string, Parameters<typeof validateBudgetCaps>[0]]> = [
      ["request > job", { requestUsdCap: 5, jobUsdCap: 3, dailyUsdCap: 10 }],
      ["job > day", { requestUsdCap: 1, jobUsdCap: 20, dailyUsdCap: 10 }],
      ["request > day", { requestUsdCap: 50, jobUsdCap: 60, dailyUsdCap: 10 }],
      ["zero", { requestUsdCap: 0, jobUsdCap: 2, dailyUsdCap: 5 }],
      ["negative", { requestUsdCap: -1, jobUsdCap: 2, dailyUsdCap: 5 }],
      ["NaN", { requestUsdCap: NaN, jobUsdCap: 2, dailyUsdCap: 5 }],
      ["Infinity", { requestUsdCap: Infinity, jobUsdCap: 2, dailyUsdCap: 5 }],
      ["-Infinity", { requestUsdCap: 1, jobUsdCap: 2, dailyUsdCap: -Infinity }],
      ["missing", { requestUsdCap: undefined, jobUsdCap: 2, dailyUsdCap: 5 }],
      ["non-numeric", { requestUsdCap: "1.00", jobUsdCap: 2, dailyUsdCap: 5 }],
      ["null", { requestUsdCap: null, jobUsdCap: 2, dailyUsdCap: 5 }],
    ];
    for (const [name, caps] of bad) {
      const r = validateBudgetCaps(caps);
      expect(r.valid, name).toBe(false);
      expect(r.problems.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps attempts out of the money, and in a sane range", () => {
    expect(validateBudgetCaps({ ...VALID, maxAttemptsPerJob: 0 }).valid).toBe(false);
    expect(validateBudgetCaps({ ...VALID, maxAttemptsPerJob: 11 }).valid).toBe(false);
    expect(validateBudgetCaps({ ...VALID, maxAttemptsPerJob: 2.5 }).valid).toBe(false);
    expect(validateBudgetCaps({ ...VALID, maxAttemptsPerJob: 1 }).valid).toBe(true);
  });

  it("the database enforces the same rules, so an invalid row cannot be stored", () => {
    expect(INVARIANTS_SQL).toMatch(/provider_budget_config_cap_ordering/);
    expect(INVARIANTS_SQL).toMatch(/request_usd_cap <= job_usd_cap/);
    expect(INVARIANTS_SQL).toMatch(/job_usd_cap <= daily_usd_cap/);
    expect(INVARIANTS_SQL).toMatch(/max_attempts_per_job between 1 and 10/);
  });

  it("guards NaN and Infinity BY EQUALITY, because numeric orders them above every real value", () => {
    // Measured on PostgreSQL 16.13: 'NaN'::numeric > 0 is TRUE. A plain
    // `check (cap > 0)` would happily accept a NaN ceiling, and admission would
    // then compute `remaining := NaN` and admit everything.
    expect(INVARIANTS_SQL).toMatch(/is_spendable_usd/);
    expect(INVARIANTS_SQL).toMatch(/v <> 'NaN'::numeric/);
    expect(INVARIANTS_SQL).toMatch(/v <> 'Infinity'::numeric/);
    expect(INVARIANTS_SQL).toMatch(/_estimated_usd = 'NaN'::numeric/);
    expect(INVARIANTS_SQL).toMatch(/non-finite-estimate/);
  });
});

// ============================================================ unset = closed
describe("a missing cap is never unlimited", () => {
  it("the ledger answers SPEND_CAP_UNSET, not zero and not unlimited", () => {
    expect(INVARIANTS_SQL).toMatch(/'reason', 'SPEND_CAP_UNSET'/);
    expect(INVARIANTS_SQL).toMatch(/'generationAllowed', false/);
  });

  it("the schema migrations seed nothing — a ceiling is a decision, not a default", () => {
    // The owner's values arrive in their own dated migration (below). These two
    // define structure only, so a schema change can never smuggle in a budget.
    expect(LEDGER_SQL).not.toMatch(/insert into public\.provider_budget_config/);
    expect(INVARIANTS_SQL).not.toMatch(/insert into public\.provider_budget_config/);
    // And no ceiling may acquire a DEFAULT, which is the other way a number
    // nobody chose becomes the number in force.
    expect(LEDGER_SQL).not.toMatch(/(request|job|daily)_usd_cap\s+numeric\([^)]*\)[^,]*default/i);
  });

  it("an unreachable ledger reports STATUS_UNAVAILABLE and forbids generation", async () => {
    const s = await providerBudgetStatus(null, "VIDEO");
    expect(s.generationAllowed).toBe(false);
    expect(s.reason).toBe("STATUS_UNAVAILABLE");

    const erroring = async () => ({ data: null, error: { message: "down" } });
    const e = await providerBudgetStatus(erroring, "VIDEO");
    expect(e.generationAllowed).toBe(false);
    expect(e.reason).toBe("STATUS_UNAVAILABLE");
  });

  it("relays the ledger's verdict rather than re-deriving one", async () => {
    const unset = async () => ({
      data: {
        capability: "VIDEO",
        generationAllowed: false,
        reason: "SPEND_CAP_UNSET",
        capsConfigured: false,
      },
      error: null,
    });
    const s = await providerBudgetStatus(unset, "VIDEO");
    expect(s.reason).toBe("SPEND_CAP_UNSET");
    expect(s.capsConfigured).toBe(false);
    expect(s.dailyUsdCap).toBeUndefined();
  });
});

// ====================================================== configured ceilings
describe("the owner's configured VIDEO ceilings", () => {
  it("stores exactly 1.00 / 5.00 / 50.00 for VIDEO, in USD", () => {
    // One insert, one capability, the owner's three numbers in cap order.
    const values = CEILINGS_SQL.match(
      /values\s*\n?\s*\(\s*'VIDEO'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*(\d+)\s*,\s*(true|false)\s*\)/i,
    );
    expect(values, "the VIDEO ceilings insert must be present and parseable").toBeTruthy();
    const [, request, job, daily, attempts, enabled] = values!;
    expect(request).toBe(OWNER_CAPS.request);
    expect(job).toBe(OWNER_CAPS.job);
    expect(daily).toBe(OWNER_CAPS.daily);
    expect(attempts).toBe("3");
    // The whole point: caps configured, generation still off.
    expect(enabled.toLowerCase()).toBe("false");
  });

  it("is a well-ordered, spendable triple by the same rules the database applies", () => {
    const caps = {
      requestUsdCap: Number(OWNER_CAPS.request),
      jobUsdCap: Number(OWNER_CAPS.job),
      dailyUsdCap: Number(OWNER_CAPS.daily),
      maxAttemptsPerJob: 3,
    };
    expect(validateBudgetCaps(caps).valid).toBe(true);
    expect(caps.requestUsdCap).toBeGreaterThan(0);
    expect(caps.requestUsdCap).toBeLessThanOrEqual(caps.jobUsdCap);
    expect(caps.jobUsdCap).toBeLessThanOrEqual(caps.dailyUsdCap);
    for (const v of Object.values(caps)) expect(Number.isFinite(v)).toBe(true);
  });

  it("configures the ceilings WITHOUT enabling generation, even on re-run", () => {
    // ON CONFLICT must update the three ceilings and must NOT carry `enabled`.
    // A migration that re-asserted enabled could flip generation on for an
    // owner who had deliberately turned it off.
    const conflict = CEILINGS_SQL.slice(CEILINGS_SQL.search(/on conflict/i));
    const setClause = conflict.slice(0, conflict.indexOf(";"));
    expect(setClause).toMatch(/request_usd_cap\s*=\s*excluded\.request_usd_cap/);
    expect(setClause).toMatch(/job_usd_cap\s*=\s*excluded\.job_usd_cap/);
    expect(setClause).toMatch(/daily_usd_cap\s*=\s*excluded\.daily_usd_cap/);
    expect(setClause, "ON CONFLICT must never touch `enabled`").not.toMatch(/\benabled\s*=/);
  });

  it("carries no FX, no INR, and no second currency", () => {
    expect(CEILINGS_SQL).not.toMatch(/usdInr|inrPerUsd|fxRate|exchangeRate|_inr\b|₹/i);
    expect(CEILINGS_SQL).toMatch(/USD/);
  });

  it("targets VIDEO and nothing else", () => {
    const capabilities = [
      ...CEILINGS_SQL.matchAll(/'(SEARCH|TEXT|IMAGE|VIDEO|VIDEO_AUDIO|TTS|OTHER)'/g),
    ]
      .map((m) => m[1])
      .filter((c, i, a) => a.indexOf(c) === i);
    expect(capabilities).toEqual(["VIDEO"]);
  });

  it("verifies its own write rather than trusting the insert to have landed", () => {
    // A no-op insert would leave the ledger fail-closed, not overspending — but
    // the ceilings in force would not be the ceilings the owner set.
    expect(CEILINGS_SQL).toMatch(/raise exception/i);
    expect(CEILINGS_SQL).toMatch(/is_spendable_usd/);
  });
});

// ============================================================ float safety
describe("financial arithmetic does not drift", () => {
  it("rounds to the ledger column's own precision", () => {
    expect(USD_DECIMALS).toBe(6);
    // The two that actually bite at ONIQ's rates.
    expect(0.1 * 3).not.toBe(0.3); // the hazard, stated
    expect(roundUsd(0.1 * 3)).toBe(0.3);
    expect(0.03 * 60).not.toBe(1.8);
    expect(roundUsd(0.03 * 60)).toBe(1.8);
  });

  it("keeps a non-finite input non-finite rather than inventing a number", () => {
    expect(Number.isNaN(roundUsd(NaN))).toBe(true);
    expect(Number.isNaN(roundUsd(Infinity))).toBe(true);
  });

  it("every USD figure the router emits is exact at 6dp", () => {
    const exact = (v: number) => expect(Math.round(v * 1e6) / 1e6).toBe(v);
    exact(videoUsd("veo-3.1-lite", 60, "VIDEO_ONLY", "google-agent-platform"));
    exact(videoUsd("veo-3.1-fast-generate-preview", 8, "ONIQ_SOUND"));
    exact(usdPerAttempt("veo-3.1-lite-generate-preview", 6, "ONIQ_SOUND"));
    const c = compareGoogleSurfaces(60, "lite");
    expect(c.geminiApiUsd).toBe(3);
    expect(c.agentPlatformVideoOnlyUsd).toBe(1.8);
    expect(c.differenceUsd).toBe(1.2);
  });
});

// ============================================================ routing gate
describe("chooseTier refuses on preconditions before it looks at quality", () => {
  const ev = {
    motionClass: "WALKING",
    liteAcceptance: 0.9,
    fastAcceptance: 0.95,
    blind: true,
    benchmarkId: "v1",
  };
  const open = { generationAllowed: true, spendCapsConfigured: true, providerAvailable: true };

  it("refuses when no gate is supplied at all — omission is not permission", () => {
    const c = chooseTier(ev, 0.65);
    expect(c.tier).toBeNull();
    expect(c.reason).toMatch(/preconditions unknown/);
  });

  it("refuses when the VIDEO spend caps are unset", () => {
    const c = chooseTier(ev, 0.65, {
      ...open,
      spendCapsConfigured: false,
      reason: "SPEND_CAP_UNSET",
    });
    expect(c.tier).toBeNull();
    expect(c.reason).toBe("SPEND_CAP_UNSET");
  });

  it("refuses when generation is not allowed", () => {
    expect(chooseTier(ev, 0.65, { ...open, generationAllowed: false }).tier).toBeNull();
  });

  it("refuses when the provider is unavailable", () => {
    expect(chooseTier(ev, 0.65, { ...open, providerAvailable: false }).tier).toBeNull();
  });

  it("checks preconditions BEFORE evidence — a caps failure is reported, not a benchmark one", () => {
    const c = chooseTier(null, 0.65, { ...open, spendCapsConfigured: false });
    expect(c.reason).not.toMatch(/benchmark/);
  });

  it("only decides when every precondition AND the evidence are present", () => {
    expect(chooseTier(ev, 0.65, open).tier).toBe("LITE");
  });
});

// ============================================================ providers
describe("provider abstraction keeps surface facts out of story composition", () => {
  const gemini = new GeminiDeveloperApiProvider();
  const agent = new GoogleAgentPlatformProvider();
  const base = {
    model: "veo-3.1-fast-generate-preview",
    seconds: 8,
    aspectRatio: "9:16",
    resolution: "720p" as const,
    prompt: "a woman turns to face the camera",
    startFrame: { base64: "AAAA", mimeType: "image/png" },
  };

  it("reports each surface's real audio capability", () => {
    expect(gemini.capabilities().canDeclineAudio).toBe(false);
    expect(agent.capabilities().canDeclineAudio).toBe(true);
    expect(providerForSurface("google-ai-studio")?.id).toBe("gemini-developer-api");
    expect(providerForSurface("google-agent-platform")?.id).toBe("google-agent-platform");
  });

  it("NEVER emits generateAudio on the Gemini Developer API, in any mode", () => {
    for (const audioMode of ["VIDEO_ONLY", "ONIQ_SOUND", "VEO_NATIVE_AUDIO"] as const) {
      const body = gemini.buildStartBody({ ...base, audioMode });
      expect(JSON.stringify(body), audioMode).not.toMatch(/generateAudio/);
    }
  });

  it("emits generateAudio on the Agent Platform, and only asks for audio when the mode wants it", () => {
    const p = (m: "VIDEO_ONLY" | "ONIQ_SOUND" | "VEO_NATIVE_AUDIO") =>
      (agent.buildStartBody({ ...base, audioMode: m }).parameters as Record<string, unknown>)
        .generateAudio;
    expect(p("VIDEO_ONLY")).toBe(false);
    expect(p("ONIQ_SOUND")).toBe(false);
    expect(p("VEO_NATIVE_AUDIO")).toBe(true);
  });

  it("a request body carries no credential and no URL", () => {
    const blob = JSON.stringify([
      gemini.buildStartBody({ ...base, audioMode: "ONIQ_SOUND" }),
      agent.buildStartBody({ ...base, audioMode: "ONIQ_SOUND" }),
    ]);
    expect(blob).not.toMatch(/api[_-]?key|Authorization|Bearer|https?:\/\//i);
  });

  it("distinguishes every failure shape the ledger needs to tell apart", () => {
    const cases: Array<[number, unknown, string]> = [
      [429, { error: { message: "RESOURCE_EXHAUSTED" } }, "QUOTA_EXHAUSTED"],
      [503, {}, "PROVIDER_FAILURE"],
      [400, { error: { message: "prohibited content" } }, "SAFETY_REFUSAL"],
      [400, { error: { message: "bad durationSeconds" } }, "INVALID_REQUEST"],
      [404, {}, "PROVIDER_FAILURE"],
    ];
    for (const [status, body, kind] of cases) {
      expect(gemini.normalizeStart(status, body).kind, `${status}`).toBe(kind);
      expect(agent.normalizeStart(status, body).kind, `${status}`).toBe(kind);
    }
  });

  it("separates EMPTY_RESULT from a provider failure — they are not the same denominator", () => {
    const filtered = { done: true, response: { generateVideoResponse: { generatedSamples: [] } } };
    expect(gemini.normalizePoll(200, filtered).kind).toBe("EMPTY_RESULT");
    const failed = { done: true, error: { message: "internal" } };
    expect(gemini.normalizePoll(200, failed).kind).toBe("PROVIDER_FAILURE");
    const refused = { done: true, error: { message: "blocked by safety" } };
    expect(gemini.normalizePoll(200, refused).kind).toBe("SAFETY_REFUSAL");
  });

  it("reports a finished clip, and leaves AUDIO UNKNOWN until the media is probed", () => {
    const done = {
      done: true,
      response: {
        generateVideoResponse: {
          generatedSamples: [
            { video: { uri: "https://x/files/1:download", mimeType: "video/mp4" } },
          ],
        },
      },
    };
    const out = gemini.normalizePoll(200, done);
    expect(out.kind).toBe("GENERATED");
    expect(out.video?.uri).toBeTruthy();
    // The request cannot establish this on either surface.
    expect(out.audio).toBe("UNKNOWN");
  });

  it("still PENDING while the operation runs", () => {
    expect(gemini.normalizePoll(200, { done: false }).kind).toBe("PENDING");
  });

  it("reports missing configuration by NAME and never by value", () => {
    const none = providerConfigStatus(agent, () => false);
    expect(none.configured).toBe(false);
    expect(none.missing).toContain("GOOGLE_CLOUD_PROJECT");
    const all = providerConfigStatus(agent, () => true);
    expect(all.configured).toBe(true);
    expect(all.missing).toEqual([]);
    // The requirement list is names only — nothing that could be a secret.
    for (const n of agent.configRequirements()) expect(n).toMatch(/^[A-Z0-9_]+$/);
    for (const n of gemini.configRequirements()) expect(n).toMatch(/^[A-Z0-9_]+$/);
  });

  it("story composition does not import a provider", () => {
    // The abstraction is worthless if the composition layer reaches past it.
    const film = read("remotion/src/story/StoryFilm.tsx");
    expect(film).not.toMatch(/videoProvider|generativelanguage|aiplatform/);
  });
});

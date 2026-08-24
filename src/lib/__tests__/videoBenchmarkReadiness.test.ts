/**
 * PROVIDER READINESS AND BENCHMARK PREPARATION — all of it at $0.
 *
 * Every provider response in this file is a HAND-WRITTEN FIXTURE. Nothing here
 * came from Google, none of it is evidence that either surface works, and no
 * acceptance rate is asserted anywhere. The point is to prove the SHAPE is
 * right so that the first real probe does not also have to be the first
 * integration test.
 *
 *   FIXTURE CLASSIFICATION: MOCK — NOT_LIVE_EVIDENCE
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GeminiDeveloperApiProvider,
  GoogleAgentPlatformProvider,
  VIDEO_OUTCOME_KINDS,
  mayHaveBeenBilled,
  providerConfigStatus,
  requireProviderConfiguration,
} from "../../../supabase/functions/_shared/videoProvider.ts";
import {
  BENCHMARK_MATRIX,
  MOTION_CLASSES,
  GENERATIVE_MOTION_CLASSES,
  benchmarkStatus,
  blindLabel,
  buildBlindPlan,
  evaluatorView,
  firstProbePreflight,
  leaksBlinding,
  unblind,
  validateAcceptance,
  validateCorpus,
  type AcceptanceRecord,
  type CorpusManifest,
} from "../../../supabase/functions/_shared/videoBenchmark.ts";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const gemini = new GeminiDeveloperApiProvider();
const agent = new GoogleAgentPlatformProvider();

const REQ = {
  model: "veo-3.1-fast-generate-preview",
  seconds: 8,
  aspectRatio: "9:16",
  resolution: "720p" as const,
  prompt: "a woman turns to face the camera",
  audioMode: "ONIQ_SOUND" as const,
};

// A frozen, clean, synthetic manifest. These are NOT real assets — the hashes
// are fabricated placeholders, which is exactly why this can never be mistaken
// for a real corpus.
const sha = (n: number) =>
  String(n)
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, "a");
const CLEAN: CorpusManifest = {
  manifestVersion: "corpus-v0-schema-only",
  frozen: true,
  createdAt: "2026-08-24T00:00:00Z",
  samples: [
    {
      sourceId: "bench/walk-01",
      motionClass: "WALKING",
      prompt: "p",
      startFrameSha256: sha(1),
      seconds: 8,
    },
    {
      sourceId: "bench/talk-01",
      motionClass: "TALKING",
      prompt: "p",
      startFrameSha256: sha(2),
      seconds: 8,
    },
    {
      sourceId: "bench/gest-01",
      motionClass: "GESTURE",
      prompt: "p",
      startFrameSha256: sha(3),
      seconds: 8,
    },
  ],
};

// ==================================================== §6 static readiness
describe("provider adapters are testable without a socket", () => {
  it("refuses a missing configuration BEFORE any request could be billed", () => {
    const none = requireProviderConfiguration(agent, () => false);
    expect(none?.kind).toBe("CONFIGURATION_FAILURE");
    expect(none?.detail).toMatch(/PROVIDER_CONFIGURATION_MISSING/);
    // Names, never values.
    expect(none?.detail).toMatch(/GOOGLE_CLOUD_PROJECT/);
    expect(none?.detail).not.toMatch(/AIza|sb_secret|eyJ|Bearer/);
    // Fully configured ⇒ no refusal, and still no network in sight.
    expect(requireProviderConfiguration(agent, () => true)).toBeNull();
  });

  it("names each surface's own missing variables", () => {
    expect(providerConfigStatus(gemini, () => false).missing).toEqual(["GOOGLE_AI_API_KEY"]);
    const a = providerConfigStatus(agent, () => false).missing;
    expect(a).toContain("GOOGLE_CLOUD_PROJECT");
    expect(a).toContain("GOOGLE_CLOUD_LOCATION");
    expect(a).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    // A partially-configured surface is still unconfigured.
    const partial = providerConfigStatus(agent, (n) => n === "GOOGLE_CLOUD_PROJECT");
    expect(partial.configured).toBe(false);
    expect(partial.missing).not.toContain("GOOGLE_CLOUD_PROJECT");
  });

  it("maps every failure the taxonomy names — MOCK fixtures, NOT_LIVE_EVIDENCE", () => {
    const cases: Array<[number, unknown, string]> = [
      [401, { error: { message: "API key not valid" } }, "AUTHENTICATION_FAILURE"],
      [403, { error: { message: "permission denied" } }, "AUTHENTICATION_FAILURE"],
      [429, { error: { message: "RESOURCE_EXHAUSTED: daily limit" } }, "QUOTA_EXHAUSTED"],
      [429, { error: { message: "too many requests per minute" } }, "RATE_LIMITED"],
      [400, { error: { message: "prohibited content" } }, "SAFETY_REFUSAL"],
      [400, { error: { message: "bad durationSeconds" } }, "INVALID_REQUEST"],
      [503, {}, "PROVIDER_FAILURE"],
      [500, {}, "PROVIDER_FAILURE"],
    ];
    for (const [status, body, kind] of cases) {
      expect(gemini.normalizeStart(status, body).kind, `gemini ${status}`).toBe(kind);
      expect(agent.normalizeStart(status, body).kind, `agent ${status}`).toBe(kind);
    }
  });

  it("keeps a daily quota and a per-minute limit apart", () => {
    // The distinction a previous benchmark paid to learn: one is a wall with a
    // clock on it, the other clears on its own.
    const quota = gemini.normalizeStart(429, { error: { message: "RESOURCE_EXHAUSTED" } });
    const rate = gemini.normalizeStart(429, { error: { message: "requests per minute exceeded" } });
    expect(quota.kind).toBe("QUOTA_EXHAUSTED");
    expect(rate.kind).toBe("RATE_LIMITED");
    expect(quota.kind).not.toBe(rate.kind);
  });

  it("separates empty output from a provider failure and from a refusal", () => {
    const filtered = { done: true, response: { generateVideoResponse: { generatedSamples: [] } } };
    expect(gemini.normalizePoll(200, filtered).kind).toBe("EMPTY_OUTPUT");
    expect(gemini.normalizePoll(200, { done: true, error: { message: "internal" } }).kind).toBe(
      "PROVIDER_FAILURE",
    );
    expect(
      gemini.normalizePoll(200, { done: true, error: { message: "blocked by safety" } }).kind,
    ).toBe("SAFETY_REFUSAL");
    expect(gemini.normalizePoll(200, { done: false }).kind).toBe("PENDING");
  });

  it("reports a successful response shape, with audio UNKNOWN until probed", () => {
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
    // The request never establishes audio on either surface.
    expect(out.audio).toBe("UNKNOWN");
    expect(agent.normalizePoll(200, done).audio).toBe("UNKNOWN");
  });

  it("knows which failures may already have cost money", () => {
    // The ledger branches on exactly this: release vs settle.
    expect(mayHaveBeenBilled("CONFIGURATION_FAILURE")).toBe(false);
    expect(mayHaveBeenBilled("AUTHENTICATION_FAILURE")).toBe(false);
    expect(mayHaveBeenBilled("QUOTA_EXHAUSTED")).toBe(false);
    // A timeout is ambiguous, so it must be treated as billable.
    expect(mayHaveBeenBilled("TIMEOUT")).toBe(true);
    expect(mayHaveBeenBilled("EMPTY_OUTPUT")).toBe(true);
    expect(mayHaveBeenBilled("MEDIA_RETRIEVAL_FAILURE")).toBe(true);
    expect(mayHaveBeenBilled("GENERATED")).toBe(true);
  });

  it("names every category the taxonomy is required to distinguish", () => {
    for (const k of [
      "AUTHENTICATION_FAILURE",
      "CONFIGURATION_FAILURE",
      "INVALID_REQUEST",
      "QUOTA_EXHAUSTED",
      "RATE_LIMITED",
      "SAFETY_REFUSAL",
      "PROVIDER_FAILURE",
      "TIMEOUT",
      "EMPTY_OUTPUT",
      "MEDIA_RETRIEVAL_FAILURE",
      "UNKNOWN_PROVIDER_FAILURE",
    ]) {
      expect(VIDEO_OUTCOME_KINDS, k).toContain(k);
    }
  });

  it("does not re-implement the transport taxonomy it already has", () => {
    const src = read("supabase/functions/_shared/videoProvider.ts");
    expect(src).toMatch(/classifyProviderError/);
    // The 429-splitting regexes must live in exactly one module.
    expect(src).not.toMatch(/RESOURCE_EXHAUSTED/);
  });

  it("still never emits generateAudio on the Developer API, in any mode", () => {
    for (const audioMode of ["VIDEO_ONLY", "ONIQ_SOUND", "VEO_NATIVE_AUDIO"] as const) {
      expect(JSON.stringify(gemini.buildStartBody({ ...REQ, audioMode }))).not.toMatch(
        /generateAudio/,
      );
    }
  });

  it("carries no credential and no URL in any request body", () => {
    const blob = JSON.stringify([gemini.buildStartBody(REQ), agent.buildStartBody(REQ)]);
    expect(blob).not.toMatch(/api[_-]?key|Authorization|Bearer|https?:\/\/|AIza|sb_secret|eyJ/i);
  });
});

// ==================================================== §14 clean corpus
describe("the benchmark corpus must be clean and frozen", () => {
  it("accepts a frozen, hashed, multi-class manifest", () => {
    expect(validateCorpus(CLEAN).valid).toBe(true);
  });

  it("rejects the contaminated design sheets by provenance", () => {
    const dirty: CorpusManifest = {
      ...CLEAN,
      samples: [
        {
          sourceId: "remotion/public/sheets/cut/aladdin.png",
          motionClass: "WALKING",
          prompt: "p",
          startFrameSha256: sha(4),
          seconds: 8,
        },
      ],
    };
    expect(validateCorpus(dirty).problems).toContain("CONTAMINATED_SOURCE");
  });

  it("rejects unfrozen, empty, duplicated, unhashed and ragged manifests", () => {
    expect(validateCorpus(null).problems).toContain("EMPTY");
    expect(validateCorpus({ ...CLEAN, frozen: false }).problems).toContain("NOT_FROZEN");
    expect(
      validateCorpus({ ...CLEAN, samples: [CLEAN.samples[0], CLEAN.samples[0]] }).problems,
    ).toContain("DUPLICATE_SOURCE_ID");
    expect(
      validateCorpus({ ...CLEAN, samples: [{ ...CLEAN.samples[0], startFrameSha256: "nope" }] })
        .problems,
    ).toContain("MISSING_HASH");
    // Different durations would compare different products.
    expect(
      validateCorpus({
        ...CLEAN,
        samples: [CLEAN.samples[0], { ...CLEAN.samples[1], seconds: 6 }],
      }).problems,
    ).toContain("INCONSISTENT_SECONDS");
    // A corpus of stills measures nothing about a video model.
    expect(
      validateCorpus({
        ...CLEAN,
        samples: [{ ...CLEAN.samples[0], motionClass: "STATIC" }],
      }).problems,
    ).toContain("NO_GENERATIVE_CLASS");
  });

  it("keeps the repository's seven motion classes and invents no three", () => {
    expect(MOTION_CLASSES).toHaveLength(7);
    const src = read("src/lib/motionProvider.ts");
    for (const c of MOTION_CLASSES) expect(src, c).toMatch(new RegExp(`"${c}"`));
    expect(GENERATIVE_MOTION_CLASSES).toHaveLength(5);
    expect(GENERATIVE_MOTION_CLASSES).not.toContain("STATIC");
  });
});

// ==================================================== §15 blinding
describe("blinding is built into the plan, not applied afterwards", () => {
  const plan = buildBlindPlan(CLEAN, BENCHMARK_MATRIX, 20260824);

  it("covers every sample in every cell", () => {
    expect(plan.totalGenerations).toBe(CLEAN.samples.length * BENCHMARK_MATRIX.length);
    for (const cell of BENCHMARK_MATRIX) {
      expect(plan.assignments.filter((a) => a.cellId === cell.cellId)).toHaveLength(
        CLEAN.samples.length,
      );
    }
  });

  it("labels opaquely, and the label reveals nothing", () => {
    expect(blindLabel(0)).toBe("B001");
    expect(blindLabel(6)).toBe("B007");
    for (const l of plan.order) expect(l).toMatch(/^B\d{3}$/);
  });

  it("hides surface, tier, model and price from the evaluator's view", () => {
    const view = JSON.stringify(evaluatorView(plan));
    expect(leaksBlinding(view)).toBe(false);
    for (const term of ["gemini", "veo", "lite", "fast", "agent", "google", "$"]) {
      expect(view.toLowerCase(), term).not.toContain(term);
    }
    // And the view must not carry the mapping.
    expect(view).not.toMatch(/cellId|sourceId/);
  });

  it("does not let position correlate with tier", () => {
    // Labelling before shuffling would make B001..B003 one contiguous cell.
    const firstThree = plan.order
      .slice(0, 3)
      .map((l) => plan.assignments.find((a) => a.label === l)!.cellId);
    expect(new Set(firstThree).size).toBeGreaterThan(1);
  });

  it("is deterministic — a plan nobody can re-derive cannot be audited", () => {
    // What varies with the seed is the MAPPING (which cell each opaque label
    // stands for), not the label sequence. `order` is B001..B0NN by
    // construction, which is the point: the sequence itself carries nothing.
    const cells = (p: typeof plan) => p.assignments.map((a) => a.cellId);
    const again = buildBlindPlan(CLEAN, BENCHMARK_MATRIX, 20260824);
    expect(again.order).toEqual(plan.order);
    expect(cells(again)).toEqual(cells(plan));

    const different = buildBlindPlan(CLEAN, BENCHMARK_MATRIX, 7);
    expect(different.order).toEqual(plan.order); // labels are always B001..
    expect(cells(different)).not.toEqual(cells(plan)); // the mapping re-randomises
  });

  it("catches an unblinding leak in text meant for an evaluator", () => {
    expect(leaksBlinding("Clip B004, generated by Veo Fast")).toBe(true);
    expect(leaksBlinding("Sample B004. Rate the motion.")).toBe(false);
  });
});

// ==================================================== §16 acceptance
describe("acceptance is recorded, never computed", () => {
  const plan = buildBlindPlan(CLEAN, BENCHMARK_MATRIX, 1);
  const score = (label: string, accepted: boolean): AcceptanceRecord => ({
    sampleId: label,
    motionClass: plan.assignments.find((a) => a.label === label)!.motionClass,
    accepted,
    rejectionReason: accepted ? null : "limbs deform",
    evaluationVersion: "eval-v1",
    evaluator: "owner",
    timestamp: "2026-08-24T00:00:00Z",
  });
  const full = plan.order.map((l, i) => score(l, i % 2 === 0));

  it("requires complete coverage of the plan", () => {
    expect(validateAcceptance(plan, full).valid).toBe(true);
    expect(validateAcceptance(plan, full.slice(0, 3)).problems).toContain("INCOMPLETE_COVERAGE");
  });

  it("requires a reason for every rejection, and none for an acceptance", () => {
    const bad = [...full];
    bad[1] = { ...bad[1], accepted: false, rejectionReason: null };
    expect(validateAcceptance(plan, bad).problems).toContain("MISSING_REJECTION_REASON");
    const odd = [...full];
    odd[0] = { ...odd[0], accepted: true, rejectionReason: "looks fine?" };
    expect(validateAcceptance(plan, odd).problems).toContain("REJECTION_REASON_ON_ACCEPTED");
  });

  it("rejects unknown labels, duplicates and unattributed scores", () => {
    expect(validateAcceptance(plan, [...full, score(plan.order[0], true)]).problems).toContain(
      "DUPLICATE_SCORE",
    );
    const unknown = [...full.slice(1), { ...full[0], sampleId: "B999" }];
    expect(validateAcceptance(plan, unknown).problems).toContain("UNKNOWN_LABEL");
    const anon = [...full];
    anon[0] = { ...anon[0], evaluator: "" };
    expect(validateAcceptance(plan, anon).problems).toContain("MISSING_EVALUATOR");
  });

  it("refuses to unblind an incomplete scoring set", () => {
    const r = unblind(plan, full.slice(0, 2));
    expect(r.ok).toBe(false);
  });

  it("unblinds only after validation, and reports per cell and class", () => {
    const r = unblind(plan, full);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.byCell).sort()).toEqual(BENCHMARK_MATRIX.map((c) => c.cellId).sort());
      const totals = Object.values(r.byCell)
        .flat()
        .reduce((n, row) => n + row.total, 0);
      expect(totals).toBe(plan.totalGenerations);
    }
  });

  it("holds no acceptance rate of its own — there is no benchmark evidence yet", () => {
    const src = read("supabase/functions/_shared/videoBenchmark.ts");
    // No literal acceptance fractions may be hard-coded anywhere in the module.
    expect(src).not.toMatch(/acceptance\s*[:=]\s*0?\.\d+/i);
    expect(src).toMatch(/NOT MEASURED/);
  });
});

// ==================================================== §21 first-probe gate
describe("the gate that protects the first paid probe", () => {
  const ALL: Parameters<typeof firstProbePreflight>[0] = {
    credentialsPresent: true,
    providerConfigured: true,
    generationAllowed: true,
    spendCapsConfigured: true,
    jobBudgetAvailable: true,
    dailyBudgetAvailable: true,
    attemptAvailable: true,
    manifestFrozen: true,
    evaluationVersionFrozen: true,
  };

  it("allows only when every precondition holds", () => {
    expect(firstProbePreflight(ALL).allowed).toBe(true);
  });

  it("refuses NO_PROVIDER_CALL if any single precondition is missing", () => {
    for (const key of Object.keys(ALL) as Array<keyof typeof ALL>) {
      const v = firstProbePreflight({ ...ALL, [key]: false });
      expect(v.allowed, key).toBe(false);
      if (!v.allowed) expect(v.verdict).toBe("NO_PROVIDER_CALL");
    }
  });

  it("treats an ABSENT precondition as unmet — omission is not permission", () => {
    const v = firstProbePreflight({});
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.blockers.length).toBe(Object.keys(ALL).length);
  });

  it("never infers authorization from credentials, caps or readiness", () => {
    // Everything technically ready, owner has NOT authorised.
    const v = firstProbePreflight({ ...ALL, generationAllowed: false });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.blockers.join(" ")).toMatch(/generation_allowed is false/);
  });

  it("reports today's real state as READY_FOR_CREDENTIALS, not ready to probe", () => {
    const today = {
      manifestFrozen: true,
      evaluationVersionFrozen: true,
      credentialsPresent: false,
      providerConfigured: false,
      generationAllowed: false,
    };
    expect(benchmarkStatus(today)).toBe("READY_FOR_CREDENTIALS");
    expect(benchmarkStatus({ manifestFrozen: false })).toBe("NOT_READY");
    expect(benchmarkStatus(ALL)).toBe("READY_FOR_CONTROLLED_PROBE");
  });
});

// ==================================================== §18/§20 matrix + spend
describe("the benchmark matrix and its spend path", () => {
  it("prepares exactly the four cells, and keeps the surfaces distinct", () => {
    expect(BENCHMARK_MATRIX).toHaveLength(4);
    const studio = BENCHMARK_MATRIX.filter((c) => c.surface === "google-ai-studio");
    const platform = BENCHMARK_MATRIX.filter((c) => c.surface === "google-agent-platform");
    expect(studio).toHaveLength(2);
    expect(platform).toHaveLength(2);
    // The Developer API cannot buy the video-only SKU. Claiming otherwise here
    // would be the exact confusion the SDK evidence disproved.
    for (const c of studio) expect(c.audioMode).not.toBe("VIDEO_ONLY");
    for (const c of platform) expect(c.audioMode).toBe("VIDEO_ONLY");
  });

  it("restates no prices — rates stay in one module", () => {
    const src = read("supabase/functions/_shared/videoBenchmark.ts");
    expect(src).not.toMatch(/0\.0[358]\b/);
    expect(src).not.toMatch(/usdPerSecond/);
  });

  it("carries no FX and no INR", () => {
    const src = read("supabase/functions/_shared/videoBenchmark.ts");
    expect(src).not.toMatch(/usdInr|inrPerUsd|fxRate|exchangeRate|_inr\b|₹/i);
  });

  it("contains no credential-shaped strings in any fixture", () => {
    const src = read("src/lib/__tests__/videoBenchmarkReadiness.test.ts");
    expect(src).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    expect(src).not.toMatch(/sb_secret_[0-9A-Za-z]/);
    expect(src).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\./);
  });
});

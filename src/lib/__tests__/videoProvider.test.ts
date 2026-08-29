// The production launch configuration is load-bearing: these tests pin
// the owner's 2026-08-26 decision so a drive-by edit cannot quietly make
// Google mandatory, enable Wan, or widen the GPU envelope.
import { describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_MODELS_ENABLED,
  MODEL_EVALUATION,
  mayServeUsers,
  GOOGLE_VIDEO_REQUIRED,
  MEDIA_VIDEO_GENERATION_ENABLED,
  VIDEO_GPU,
  VIDEO_LIMITS,
  VIDEO_MAX_WORKERS,
  VIDEO_MIN_WORKERS,
  VIDEO_MODEL,
  VIDEO_PROVIDER,
  VIDEO_PROVIDERS,
  WAN_GENERATION_ENABLED,
  selectVideoProvider,
} from "@/lib/videoProvider.server";

describe("video provider — production launch flags (owner directive 2026-08-26)", () => {
  it("in-house is the primary provider and generation is enabled", () => {
    expect(MEDIA_VIDEO_GENERATION_ENABLED).toBe(true);
    expect(VIDEO_PROVIDER).toBe("in_house");
    expect(VIDEO_MODEL).toBe("LTX_VIDEO_2B");
    expect(VIDEO_GPU).toBe("RTX_A5000");
    expect(selectVideoProvider()).toBe(VIDEO_PROVIDERS.in_house);
    expect(VIDEO_PROVIDERS.in_house.role).toBe("primary");
  });

  it("Google is optional, never required", () => {
    expect(GOOGLE_VIDEO_REQUIRED).toBe(false);
    expect(VIDEO_PROVIDERS.google_veo.role).toBe("optional_fallback");
  });
});

describe("model evaluation — owner directive 2026-08-29 (WAN = candidate)", () => {
  it("Wan is a candidate, no longer disabled", () => {
    expect(MODEL_EVALUATION.WAN_2_1_I2V_14B.status).toBe("candidate");
    expect(MODEL_EVALUATION.WAN_2_2_I2V_A14B.status).toBe("candidate");
  });

  it("candidate is NOT enabled: no candidate may serve a user", () => {
    // The load-bearing distinction. Reclassifying Wan changes what ONIQ may
    // LEARN about it, never what it may spend or ship.
    for (const [model, evaluation] of Object.entries(MODEL_EVALUATION)) {
      if (evaluation.status === "candidate") {
        expect(mayServeUsers(model)).toBe(false);
      }
    }
    expect(WAN_GENERATION_ENABLED).toBe(false);
    expect(EXPERIMENTAL_MODELS_ENABLED).toBe(false);
  });

  it("exactly one model is in production, and it is the one that ships", () => {
    const production = Object.entries(MODEL_EVALUATION).filter(
      ([, e]) => e.status === "production",
    );
    expect(production.map(([m]) => m)).toEqual(["LTX_VIDEO_2B"]);
    expect(mayServeUsers(VIDEO_MODEL)).toBe(true);
  });

  it("an unknown model can never serve users", () => {
    expect(mayServeUsers("SOMETHING_ELSE")).toBe(false);
    expect(mayServeUsers("")).toBe(false);
  });

  it("every candidate records a licence and what still blocks it", () => {
    // The brief asks for the licence verified before production use, so a
    // candidate with no recorded licence is a candidate nobody checked.
    for (const [, evaluation] of Object.entries(MODEL_EVALUATION)) {
      expect(evaluation.licence.length).toBeGreaterThan(0);
      expect(evaluation.blocking.length).toBeGreaterThan(0);
    }
  });

  it("Wan is the only Apache-2.0 family in the set", () => {
    // Measured, and materially relevant to a commercial product: every other
    // candidate ships under its publisher's own terms.
    const apache = Object.entries(MODEL_EVALUATION)
      .filter(([, e]) => e.licence === "apache-2.0")
      .map(([m]) => m);
    expect(apache.sort()).toEqual(["WAN_2_1_I2V_14B", "WAN_2_2_I2V_A14B"]);
  });

  it("selection is server-controlled: the selector accepts no caller input", () => {
    expect(selectVideoProvider.length).toBe(0);
  });

  it("worker envelope stays zero-idle and single-worker", () => {
    expect(VIDEO_MIN_WORKERS).toBe(0);
    expect(VIDEO_MAX_WORKERS).toBe(1);
  });

  it("initial limits match the measured production envelope", () => {
    expect(VIDEO_LIMITS).toEqual({
      width: 704,
      height: 480,
      fps: 24,
      minSeconds: 3,
      maxSeconds: 5,
      concurrency: 1,
      maxRuntimeSeconds: 900,
      jobCeilingUsd: 0.5,
    });
  });
});

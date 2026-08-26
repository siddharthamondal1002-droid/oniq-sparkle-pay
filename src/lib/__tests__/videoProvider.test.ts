// The production launch configuration is load-bearing: these tests pin
// the owner's 2026-08-26 decision so a drive-by edit cannot quietly make
// Google mandatory, enable Wan, or widen the GPU envelope.
import { describe, expect, it } from "vitest";

import {
  EXPERIMENTAL_MODELS_ENABLED,
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

  it("Google is optional, never required — and Wan stays experimental/off", () => {
    expect(GOOGLE_VIDEO_REQUIRED).toBe(false);
    expect(VIDEO_PROVIDERS.google_veo.role).toBe("optional_fallback");
    expect(WAN_GENERATION_ENABLED).toBe(false);
    expect(EXPERIMENTAL_MODELS_ENABLED).toBe(false);
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

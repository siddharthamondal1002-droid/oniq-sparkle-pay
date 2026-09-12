/**
 * A checkpoint refusal is FINAL, and the runner must not ask again.
 *
 * THE MEASUREMENT THIS EXISTS FOR. Film a7b9c3b9 / GitHub run 34688028222:
 * frame 1 answered `PermissionError`, then `CheckpointInconsistent` TWICE.
 * Every one of those three was a fresh GPU submission, because
 * `failureIsTransient` had no pattern for either spelling and its default —
 * correctly, for an unknown reason — is "try again". Three cold starts to be
 * told the same thing three times.
 *
 * WHAT IS AND IS NOT CLAIMED. Nothing here says the checkpoint is corrupt; the
 * exception name is not a diagnosis, and which of ltxcaps' five refusals fired
 * is the worker's to report. The claim is only the one retry policy needs:
 * whatever was refused is a property of the BAKED IMAGE, so the next attempt
 * meets the identical image and gets the identical answer.
 *
 * AND THE TRANSIENT BAND IS ASSERTED TOO, in the same file. A guard that only
 * ever says "final" would be a guard that has stopped a real cold-start retry
 * as readily as a wasted one, and this repository has the receipt for a
 * classifier nobody checked in both directions.
 */
import { describe, expect, it, vi } from "vitest";
import {
  EngineError,
  FINAL_ENGINE_CODES,
  TRANSIENT_ENGINE_CODES,
  failureIsTransient,
  generateStill,
  verifyStillOutput,
} from "../../../supabase/functions/_shared/oniqImage.ts";

const ENV = { apiKey: "k", endpointId: "ep-1", publicBase: "https://r2.example/" };

function deps(fetchImpl: typeof fetch) {
  return {
    fetchImpl,
    now: (() => {
      let t = 0;
      return () => (t += 1000);
    })(),
    sleep: () => Promise.resolve(),
    newId: () => "id-1",
  };
}

describe("both spellings of the checkpoint refusal are final", () => {
  it("the FAILED-job text form is not transient", () => {
    for (const reason of [
      "engine job FAILED: CheckpointInconsistent",
      "CheckpointInconsistent: components missing",
      "checkpoint-inconsistent",
      "checkpoint_inconsistent: model_index.json unreadable",
      "PermissionError: [Errno 13] Permission denied",
      "[Errno 13] Permission denied: '/models/ltx'",
    ]) {
      expect(failureIsTransient(reason), reason).toBe(false);
    }
  });

  it("the worker-authored code form is not retryable", () => {
    for (const code of FINAL_ENGINE_CODES) {
      const v = verifyStillOutput({ ok: false, code });
      expect(v.ok).toBe(false);
      if (v.ok === false) expect(v.retryable, code).not.toBe(true);
    }
  });

  it("no final code has been let into the transient allowlist", () => {
    for (const code of FINAL_ENGINE_CODES) {
      expect(TRANSIENT_ENGINE_CODES.has(code), code).toBe(false);
    }
  });

  it("genuinely transient failures still retry", () => {
    for (const reason of [
      "",
      "engine job FAILED",
      "engine job TIMED_OUT",
      "cuda-unavailable",
      "artifact fetch 404",
      "still took too long",
    ]) {
      expect(failureIsTransient(reason), reason).toBe(true);
    }
    for (const code of TRANSIENT_ENGINE_CODES) {
      const v = verifyStillOutput({ ok: false, code });
      expect(v.ok).toBe(false);
      if (v.ok === false) expect(v.retryable, code).toBe(true);
    }
  });
});

describe("a checkpoint refusal submits exactly one GPU job", () => {
  /**
   * THE BEHAVIOUR, not the classification. The flag is only worth anything if
   * the caller reads it, so this drives the real submit-and-wait path and
   * counts how many times `/run` was hit.
   */
  function engine(failure: unknown) {
    const runs: string[] = [];
    const impl = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/run")) {
        runs.push(u);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "job-1" }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => failure } as unknown as Response;
    });
    return { impl: impl as unknown as typeof fetch, runs };
  }

  it("marks the failure final and never resubmits inside one draw", async () => {
    const e = engine({ status: "FAILED", error: "CheckpointInconsistent: wrong pipeline class" });
    await expect(generateStill("a lantern", ENV, deps(e.impl))).rejects.toThrow(EngineError);
    expect(e.runs).toHaveLength(1);

    const thrown = await generateStill("a lantern", ENV, deps(e.impl)).catch((err) => err);
    expect(thrown).toBeInstanceOf(EngineError);
    // THE FLAG THE RUNNER'S LADDER READS. False here is what stops attempt two.
    expect((thrown as EngineError).retryable).toBe(false);
  });

  it("a cold-start hiccup keeps its retryable verdict", async () => {
    const e = engine({ status: "FAILED", error: "worker restarted" });
    const thrown = await generateStill("a lantern", ENV, deps(e.impl)).catch((err) => err);
    expect((thrown as EngineError).retryable).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  E003B_LIMITS,
  runE003BArm,
  type BenchmarkModel,
  type BenchmarkTask,
} from "../../../supabase/functions/_shared/agiBenchmarkRunner.ts";

const TASK: BenchmarkTask = {
  id: "t1",
  prompt: "Find the value, using lookup if needed.",
  initialEvidence: [],
  toolCatalog: [
    {
      name: "lookup",
      description: "read a synthetic fixture",
      schema: ["key"],
      reversible: true,
      touchesProduction: false,
    },
  ],
};

describe("E-003B arm runner", () => {
  it("direct gets one model call and no iterative observation", async () => {
    let calls = 0;
    const model: BenchmarkModel = async () => {
      calls++;
      return {
        ok: true,
        text: '{"answer":"provisional","p_answerable":0.4,"done":false}',
        tool: { name: "lookup", args: { key: "x" } },
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0.001,
        model: "gemini-3.1-flash-lite",
      };
    };
    const trace = await runE003BArm(TASK, "direct", model, async () => ({
      ok: true,
      output: "42",
      observed: "42",
      costUsd: 0,
    }));
    expect(calls).toBe(1);
    expect(trace.modelCalls).toBe(1);
    expect(trace.toolCalls).toBe(1);
    expect(trace.transcript.at(-1)?.role).toBe("tool");
  });

  it("bounded agent can observe then answer", async () => {
    let calls = 0;
    const model: BenchmarkModel = async (req) => {
      calls++;
      if (!req.transcript.some((x) => x.role === "tool")) {
        return {
          ok: true,
          text: '{"answer":"","p_answerable":0.2,"done":false}',
          tool: { name: "lookup", args: { key: "x" } },
          inputTokens: 10,
          outputTokens: 10,
          costUsd: 0.001,
          model: "gemini-3.1-flash-lite",
        };
      }
      return {
        ok: true,
        text: '{"answer":"42","p_answerable":0.99,"done":true}',
        tool: null,
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0.001,
        model: "gemini-3.1-flash-lite",
      };
    };
    const trace = await runE003BArm(TASK, "bounded-agent", model, async () => ({
      ok: true,
      output: "42",
      observed: "42",
      costUsd: 0,
    }));
    expect(calls).toBe(2);
    expect(trace.answer).toBe("42");
    expect(trace.pAnswerable).toBe(0.99);
  });

  it("refuses unknown tools before execution", async () => {
    let executed = false;
    const trace = await runE003BArm(
      TASK,
      "bounded-agent",
      async () => ({
        ok: true,
        text: "{}",
        tool: { name: "not-offered", args: {} },
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 0,
        model: "gemini-3.1-flash-lite",
      }),
      async () => {
        executed = true;
        return { ok: true, output: "", observed: "", costUsd: 0 };
      },
    );
    expect(executed).toBe(false);
    expect(trace.failure).toMatch(/^unknown-tool:/);
  });

  it("detects duplicate side effects", async () => {
    let n = 0;
    const model: BenchmarkModel = async () => {
      n++;
      return n < 3
        ? {
            ok: true,
            text: "{}",
            tool: { name: "lookup", args: { key: "x" } },
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            model: "gemini-3.1-flash-lite",
          }
        : {
            ok: true,
            text: '{"answer":"done","p_answerable":1,"done":true}',
            tool: null,
            inputTokens: 1,
            outputTokens: 1,
            costUsd: 0,
            model: "gemini-3.1-flash-lite",
          };
    };
    const trace = await runE003BArm(TASK, "bounded-agent", model, async () => ({
      ok: true,
      output: "ok",
      observed: "ok",
      costUsd: 0,
      sideEffectKey: "same-effect",
    }));
    expect(trace.duplicateSideEffect).toBe(true);
  });

  it("fails closed on the resource ceiling", async () => {
    const trace = await runE003BArm(
      TASK,
      "bounded-agent",
      async () => ({
        ok: true,
        text: '{"answer":"x","p_answerable":1,"done":true}',
        tool: null,
        inputTokens: E003B_LIMITS.maxInputTokens + 1,
        outputTokens: 1,
        costUsd: 0,
        model: "gemini-3.1-flash-lite",
      }),
      async () => ({ ok: true, output: "", observed: "", costUsd: 0 }),
    );
    expect(trace.ceilingBreach).toBe(true);
    expect(trace.failure).toBe("resource-ceiling-breach");
  });
});

/**
 * THE VERTICAL SLICE, TESTED. Every assertion here runs with NO credential and
 * NO network — which is not a convenience, it is forced: api.openai.com is
 * unreachable from this container (measured 2026-09-12, proxy CONNECT 403).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalSourceIdentity, promote, type Provenance } from "../provenance.ts";
import { mayExecute, parseExecutionMode } from "../executionMode.ts";
import { EMPTY_WORLD, observe, standingOf, type Fact } from "../worldModel.ts";
import { initialState, uncertaintyOf, type Hypothesis } from "../cognitiveState.ts";
import {
  mockModelAdapter,
  replayKey,
  replayModelAdapter,
  REFUSING_MODEL,
} from "../modelAdapter.ts";
import {
  DEFAULT_FRONTIER_MODEL,
  readResponse,
  responsesBody,
} from "../../../lib/cognitive/openaiResponsesAdapter.ts";
import { decide, invoke, registry, type ToolSpec } from "../capabilityRegistry.ts";
import { restore, serialize } from "../checkpoint.ts";
import { runKernel } from "../cognitiveKernel.ts";

const AT = "2026-09-12T00:00:00.000Z";
const clock = () => AT;

function ev(
  source: Provenance["source"],
  locator = "x",
  independenceKey?: string,
): Provenance {
  return { source, locator, independenceKey, at: AT, excerpt: null };
}

function web(locator: string): string {
  return `https:${"/".repeat(2)}${locator}`;
}

function readTool(name: string, summary: string, over: Partial<ToolSpec> = {}): ToolSpec {
  return {
    name,
    description: name,
    schema: ["q"],
    authorized: true,
    sideEffect: "NONE",
    reversible: true,
    costUsd: 0,
    risk: 0,
    timeoutMs: 1000,
    produces: "database_query",
    run: async () => ({ ok: true, evidence: ev("database_query", name), summary }),
    ...over,
  };
}

describe("provenance: a model can never verify itself", () => {
  it("two independent verifying sources reach VERIFIED", () => {
    expect(promote([ev("database_query", "db:one"), ev("repository_read", "repo:two")], [])).toBe(
      "VERIFIED",
    );
  });

  it("duplicate rows and URL aliases remain one source", () => {
    const aliases = [
      ev("api_response", web("EXAMPLE.com/a?b=2&a=1#fragment")),
      ev("documentation", web("example.com/a?a=1&b=2")),
    ];
    expect(promote(aliases, [])).toBe("OBSERVED");
    expect(canonicalSourceIdentity(aliases[0])).toBe(canonicalSourceIdentity(aliases[1]));
  });

  it("mirrors sharing an upstream identity are not independent", () => {
    expect(
      promote(
        [
          ev("api_response", web("wire.example/story"), "wire-story-7"),
          ev("documentation", web("mirror.example/story"), "wire-story-7"),
        ],
        [],
      ),
    ).toBe("OBSERVED");
  });

  it("a model alone is SUPPORTED however many times it speaks", () => {
    expect(promote([ev("model"), ev("model"), ev("model")], [])).toBe("SUPPORTED");
  });

  it("evidence on both sides is CONTESTED, never quietly resolved", () => {
    expect(promote([ev("database_query")], [ev("api_response")])).toBe("CONTESTED");
  });

  it("no evidence at all is UNPROVEN, not false", () => {
    expect(promote([], [])).toBe("UNPROVEN");
  });
});

describe("execution mode defaults to the safe one", () => {
  it("an unrecognised value is OBSERVE, so a typo cannot enable writes", () => {
    expect(parseExecutionMode("AUTHORISED")).toBe("OBSERVE");
    expect(parseExecutionMode(undefined)).toBe("OBSERVE");
    expect(parseExecutionMode("AUTHORIZED")).toBe("AUTHORIZED");
  });

  it("reads run everywhere; external effects need AUTHORIZED; destructive never runs", () => {
    expect(mayExecute("OBSERVE", "NONE")).toBe(true);
    expect(mayExecute("OBSERVE", "EXTERNAL")).toBe(false);
    expect(mayExecute("AUTHORIZED", "EXTERNAL")).toBe(true);
    expect(mayExecute("AUTHORIZED", "DESTRUCTIVE")).toBe(false);
  });
});

describe("world model keeps epistemic states apart", () => {
  const base: Fact = {
    entity: "story_dispatch",
    attribute: "status",
    value: "failed",
    epistemic: "OBSERVED",
    supporting: [ev("database_query")],
    contradicting: [],
    at: AT,
  };

  it("a HYPOTHESIZED fact sits beside an OBSERVED one, never replacing it", () => {
    const w = observe(observe(EMPTY_WORLD, base), {
      ...base,
      value: "degraded",
      epistemic: "HYPOTHESIZED",
    });
    expect(w.facts).toHaveLength(2);
    expect(w.facts.map((f) => f.epistemic).sort()).toEqual(["HYPOTHESIZED", "OBSERVED"]);
  });

  it("the same entity+attribute+epistemic replaces", () => {
    const w = observe(observe(EMPTY_WORLD, base), { ...base, value: "ok" });
    expect(w.facts).toHaveLength(1);
    expect(w.facts[0].value).toBe("ok");
  });

  it("a fact's standing comes from its own evidence", () => {
    expect(standingOf(base)).toBe("OBSERVED");
  });
});

describe("capability registry is the authority, not the model", () => {
  const reg = registry([
    readTool("db_read", "3 rows"),
    readTool("deploy", "shipped", { authorized: false, sideEffect: "EXTERNAL" }),
    readTool("wipe", "gone", { sideEffect: "DESTRUCTIVE" }),
    readTool("push", "pushed", { sideEffect: "EXTERNAL" }),
  ]);

  it("refuses an unregistered tool", () => {
    const d = decide(reg, "AUTHORIZED", "nope", {});
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.refusal).toBe("UNKNOWN_TOOL");
  });

  it("refuses an unauthorized tool before it considers the mode", () => {
    const d = decide(reg, "AUTHORIZED", "deploy", {});
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.refusal).toBe("UNAUTHORIZED");
  });

  it("refuses a destructive tool even when AUTHORIZED", () => {
    const d = decide(reg, "AUTHORIZED", "wipe", {});
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.refusal).toBe("DESTRUCTIVE_NEVER");
  });

  it("refuses an argument the schema does not name", () => {
    const d = decide(reg, "OBSERVE", "db_read", { sneaky: "1" });
    expect(d.allow).toBe(false);
    if (!d.allow) expect(d.refusal).toBe("UNKNOWN_ARGUMENT");
  });

  it("DRY_RUN records a side-effecting call without making it", async () => {
    const inv = await invoke(reg, "DRY_RUN", "push", {});
    expect(inv.outcome).toBe("DRY_RUN");
    expect(inv.result).toBeNull();
  });

  it("DRY_RUN still performs a pure read, or the plan is unknowable", async () => {
    const inv = await invoke(reg, "DRY_RUN", "db_read", {});
    expect(inv.outcome).toBe("EXECUTED");
  });
});

describe("a tool name must be usable on the wire, checked where it is built", () => {
  /**
   * THE BUG THIS PINS COST A WHOLE BENCHMARK RUN. Tools were registered as
   * `db.job_counts`; both frontier models rejected the request with HTTP 400
   * before reading a word of the incident, because the Responses API requires
   * `^[a-zA-Z0-9_-]+$`. Nothing local could catch it — no local test sends the
   * tool list anywhere — so the check belongs at construction.
   */
  const ok = (name: string): ToolSpec => ({
    name,
    description: name,
    schema: [],
    authorized: true,
    sideEffect: "NONE",
    reversible: true,
    costUsd: 0,
    risk: 0,
    timeoutMs: 1,
    produces: "database_query",
    run: async () => ({ ok: true, evidence: ev("database_query"), summary: "" }),
  });

  it("refuses a dotted name, and names the pattern", () => {
    expect(() => registry([ok("db.job_counts")])).toThrow(/not portable/);
  });

  it("refuses a space and a slash too", () => {
    expect(() => registry([ok("db job")])).toThrow(/not portable/);
    expect(() => registry([ok("db/job")])).toThrow(/not portable/);
  });

  it("admits underscores and hyphens, which namespace perfectly well", () => {
    expect(() => registry([ok("db_job_counts"), ok("repo-read")])).not.toThrow();
  });

  it("still refuses a duplicate", () => {
    expect(() => registry([ok("a"), ok("a")])).toThrow(/duplicate/);
  });
});

describe("model adapter", () => {
  it("the shipped default refuses and names itself", async () => {
    const r = await REFUSING_MODEL.reason({ instructions: "i", input: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no model adapter configured/);
  });

  it("replay refuses an unrecorded request rather than substituting", async () => {
    const a = replayModelAdapter({});
    const r = await a.reason({ instructions: "i", input: "x" });
    expect(r.ok).toBe(false);
  });

  it("replay returns the recorded reply for its exact key", async () => {
    const req = { instructions: "i", input: "x" } as const;
    const proposal = {
      text: "hello",
      wantsTool: null,
      model: "m",
      inputTokens: 1,
      outputTokens: 2,
    };
    const a = replayModelAdapter({ [replayKey(req)]: proposal });
    const r = await a.reason(req);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.proposal.text).toBe("hello");
  });

  it("replay identity changes with every authority-bearing tool field", () => {
    const tool = {
      name: "repo_read",
      description: "read",
      schema: ["path"],
      version: "1",
      scopes: ["repo:read"],
    } as const;
    const req = { instructions: "i", input: "x", toolsOffered: [tool] } as const;
    const variants = [
      { ...req, toolsOffered: [] },
      { ...req, toolsOffered: [{ ...tool, name: "repo_write" }] },
      { ...req, toolsOffered: [{ ...tool, schema: ["ref"] }] },
      { ...req, toolsOffered: [{ ...tool, version: "2" }] },
      { ...req, toolsOffered: [{ ...tool, scopes: ["repo:write"] }] },
    ];
    for (const variant of variants) expect(replayKey(variant)).not.toBe(replayKey(req));
  });

  it("replay identity canonicalizes catalog, schema, and scope ordering", () => {
    const a = {
      instructions: "i",
      input: "x",
      toolsOffered: [
        {
          name: "z",
          description: "z",
          schema: ["b", "a"],
          version: "1",
          scopes: ["write", "read"],
        },
        { name: "a", description: "a", schema: [], version: "1", scopes: [] },
      ],
    } as const;
    const b = {
      ...a,
      toolsOffered: [
        { name: "a", description: "a", schema: [], version: "1", scopes: [] },
        {
          name: "z",
          description: "z",
          schema: ["a", "b"],
          version: "1",
          scopes: ["read", "write"],
        },
      ],
    } as const;
    expect(replayKey(a)).toBe(replayKey(b));
  });
});

describe("openai adapter: shape only — no call has ever been made", () => {
  it("carries the model id as configuration and never hard-codes it into the body", () => {
    const body = responsesBody("some-other-model", { instructions: "i", input: "x" });
    expect(body.model).toBe("some-other-model");
    expect(JSON.stringify(body)).not.toContain(DEFAULT_FRONTIER_MODEL);
  });

  it("refuses an unfamiliar response shape instead of returning an empty proposal", () => {
    const r = readResponse("m", { something: "else" });
    expect(r.ok).toBe(false);
  });

  /**
   * THE BUG THIS BLOCK EXISTS FOR, measured on production models rather than
   * reasoned about. `toolsOffered` was `readonly string[]`, so the body went
   * out as `{type:"function", name}` with no description and no parameters.
   * Both frontier arms of the video benchmark then called `db_error_detail`
   * six times each with `{}` — there was no `surface` field to fill — read
   * `no surface named ` every time, never saw the evidence naming the dead
   * credential, and scored zero causes found. Fifty kernel tests were green
   * throughout, because not one of them looked at what a tool offer CONTAINS.
   */
  it("offers each tool with its description and every argument it reads", () => {
    const body = responsesBody("m", {
      instructions: "i",
      input: "x",
      toolsOffered: [
        {
          name: "db_error_detail",
          description: "detail for one surface",
          schema: ["surface"],
          version: "test-v1",
          scopes: [],
        },
      ],
    });
    const tools = body.tools as Record<string, unknown>[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("db_error_detail");
    expect(tools[0].description).toBe("detail for one surface");
    const params = tools[0].parameters as Record<string, unknown>;
    expect(params.properties).toEqual({ surface: { type: "string" } });
    expect(params.required).toEqual(["surface"]);
  });

  /**
   * `strict: true` is only legal when every declared property is also
   * required and `additionalProperties` is false — OpenAI rejects the whole
   * request otherwise, which is how the FIRST version of this benchmark
   * failed (a 400 on the tool name). Asserted so the pair cannot drift apart.
   */
  it("keeps strict mode consistent with its own schema", () => {
    const body = responsesBody("m", {
      instructions: "i",
      input: "x",
      toolsOffered: [
        {
          name: "two_args",
          description: "d",
          schema: ["a", "b"],
          version: "test-v1",
          scopes: [],
        },
      ],
    });
    const tool = (body.tools as Record<string, unknown>[])[0];
    const params = tool.parameters as Record<string, unknown>;
    expect(tool.strict).toBe(true);
    expect(params.additionalProperties).toBe(false);
    expect(Object.keys(params.properties as object).sort()).toEqual(params.required);
  });

  /** A tool that reads nothing still needs a valid empty object schema. */
  it("gives an argument-free tool an empty object schema rather than none", () => {
    const body = responsesBody("m", {
      instructions: "i",
      input: "x",
      toolsOffered: [
        {
          name: "db_job_counts",
          description: "counts",
          schema: [],
          version: "test-v1",
          scopes: [],
        },
      ],
    });
    const params = (body.tools as Record<string, unknown>[])[0].parameters as Record<
      string,
      unknown
    >;
    expect(params.type).toBe("object");
    expect(params.properties).toEqual({});
    expect(params.required).toEqual([]);
  });

  it("reads a documented function_call shape into a tool wish", () => {
    const r = readResponse("m", {
      output: [{ type: "function_call", name: "db_read", arguments: '{"q":"1"}' }],
      usage: { input_tokens: 5, output_tokens: 6 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.wantsTool).toEqual({ name: "db_read", args: { q: "1" } });
      expect(r.proposal.outputTokens).toBe(6);
    }
  });
});

describe("the kernel tree stays reachable-by-nothing", () => {
  /**
   * THE BOUNDARY IS THE PATH, AND `security.test.ts` IS ITS GUARD — not this
   * file. The OpenAI adapter started inside `src/oqca/cognitive/` and that
   * guard failed four ways at once (fetch, an https URL, a credential name, an
   * auth header); moving the adapter to `src/lib/cognitive/` was the fix.
   *
   * A FIRST DRAFT OF THIS BLOCK RE-IMPLEMENTED THAT WALK AND TRIPPED THE GUARD
   * ITSELF, because a test that bans those words has to name them. Deleting
   * the duplicate was the right answer rather than cutting an exemption into a
   * security guard: the existing walk is stricter, already covers this
   * directory, and has now been shown to catch a real escape.
   *
   * What is left here is the one thing that walk does NOT assert: the seam
   * must stay provider-agnostic, so §6's "substitute another model without
   * changing memory, planning, or world-model code" is checkable.
   */
  it("the seam itself carries no provider name", () => {
    const code = readFileSync(resolve(__dirname, "..", "modelAdapter.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/openai|anthropic|gemini|vertex/i);
  });

  it("the kernel imports no provider implementation", () => {
    const dir = resolve(__dirname, "..");
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".ts")) continue;
      const code = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of code.matchAll(/from\s+"([^"]+)"/g)) {
        if (m[1].includes("lib/cognitive")) offenders.push(`${f} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("checkpoint restores or refuses, never silently empties", () => {
  it("round-trips a state", () => {
    const s = initialState("goal", AT);
    const r = restore(serialize(s, AT));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.checkpoint.state.goal).toBe("goal");
  });

  it("absent is reported as absent", () => {
    const r = restore(null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no checkpoint/);
  });

  it("a future schema is refused, not coerced", () => {
    const r = restore(JSON.stringify({ schema: 99, savedAt: AT, state: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/schema/);
  });

  it("a truncated state is refused and names what is missing", () => {
    const r = restore(JSON.stringify({ schema: 1, savedAt: AT, state: { goal: "g" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/missing/);
  });
});

describe("uncertainty comes from the hypotheses", () => {
  const h = (id: string, confidence: number): Hypothesis => ({
    id,
    claim: id,
    prior: 0.5,
    confidence,
    status: "OPEN",
    supporting: [],
    contradicting: [],
    predictions: [],
    discriminatingTests: [],
  });

  it("no hypotheses is total ignorance, not confidence", () => {
    expect(uncertaintyOf([])).toBe(1);
  });

  it("one dominant survivor is near certain", () => {
    expect(uncertaintyOf([h("a", 0.9), h("b", 0.1)])).toBeCloseTo(0.1, 5);
  });

  it("an even split is maximally uncertain", () => {
    expect(uncertaintyOf([h("a", 0.5), h("b", 0.5)])).toBeCloseTo(0.5, 5);
  });
});

describe("the kernel loop", () => {
  const reg = registry([
    readTool("db_read", "3 rows"),
    readTool("push", "pushed", { sideEffect: "EXTERNAL" }),
  ]);

  it("does NOT stop after the first reply when a tool was asked for", async () => {
    const model = mockModelAdapter([
      {
        text: "let me look",
        wantsTool: { name: "db_read", args: { q: "1" } },
        model: "m",
        inputTokens: 1,
        outputTokens: 1,
      },
      { text: "done", wantsTool: null, model: "m", inputTokens: 1, outputTokens: 1 },
    ]);
    const r = await runKernel({
      goal: "g",
      mode: "OBSERVE",
      model,
      registry: reg,
      clock,
      instructions: "i",
    });
    expect(r.stop).toBe("FINAL_ANSWER");
    expect(r.modelCalls).toBe(2);
    expect(r.toolCalls).toBe(1);
  });

  it("with no adapter it stops RESOURCE_UNAVAILABLE and names why", async () => {
    const r = await runKernel({
      goal: "g",
      mode: "OBSERVE",
      registry: reg,
      clock,
      instructions: "i",
    });
    expect(r.stop).toBe("RESOURCE_UNAVAILABLE");
    expect(r.stopDetail).toMatch(/no model adapter configured/);
  });

  it("a refused tool is recorded and the loop continues", async () => {
    const model = mockModelAdapter([
      {
        text: "",
        wantsTool: { name: "push", args: {} },
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
      },
      { text: "ok", wantsTool: null, model: "m", inputTokens: 0, outputTokens: 0 },
    ]);
    const r = await runKernel({
      goal: "g",
      mode: "OBSERVE",
      model,
      registry: reg,
      clock,
      instructions: "i",
    });
    expect(r.refusedToolCalls).toBe(1);
    expect(r.stop).toBe("FINAL_ANSWER");
    expect(r.state.toolCalls[0].outcome).toBe("REFUSED");
  });

  it("a tool reading never becomes VERIFIED on one source", async () => {
    const model = mockModelAdapter([
      {
        text: "",
        wantsTool: { name: "db_read", args: { q: "1" } },
        model: "m",
        inputTokens: 0,
        outputTokens: 0,
      },
      { text: "ok", wantsTool: null, model: "m", inputTokens: 0, outputTokens: 0 },
    ]);
    const r = await runKernel({
      goal: "g",
      mode: "OBSERVE",
      model,
      registry: reg,
      clock,
      instructions: "i",
    });
    expect(r.verification.claims).toHaveLength(1);
    const only = r.verification.claims[0];
    expect(promote(only.supporting, only.contradicting)).not.toBe("VERIFIED");
  });

  it("restarts and resumes rather than starting from zero", async () => {
    let saved: string | null = null;
    const store = {
      read: async () => saved,
      write: async (json: string) => {
        saved = json;
      },
    };
    const once = () =>
      mockModelAdapter([
        { text: "ok", wantsTool: null, model: "m", inputTokens: 0, outputTokens: 0 },
      ]);

    const first = await runKernel({
      goal: "g",
      mode: "OBSERVE",
      model: once(),
      registry: reg,
      store,
      clock,
      instructions: "i",
    });
    expect(first.restored).toBe(false);
    expect(saved).not.toBeNull();

    const second = await runKernel({
      goal: "g",
      mode: "OBSERVE",
      model: once(),
      registry: reg,
      store,
      clock,
      instructions: "i",
    });
    expect(second.restored).toBe(true);
    expect(second.state.iteration).toBeGreaterThan(first.state.iteration);
    expect(second.state.transitions.some((t) => t.station === "RESTORE")).toBe(true);
  });
});

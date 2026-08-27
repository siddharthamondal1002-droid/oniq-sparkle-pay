// The gpu-video edge function's USER admission, pinned (owner directive
// 2026-08-27: "make video production live for users").
//
// The rollout changed exactly one thing — WHO may call — and these pins hold
// everything that must not have moved with it: every financial gate in its
// original order, exactly two provider submissions per voiced job, no new
// egress, and a strict privacy boundary (a user sees and signs only their
// own jobs, and never sees operator fields). Parsed from the source the way
// the workflow gates are — a gate that only exists in prose is not a gate.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const EDGE = stripComments(
  readFileSync(join(process.cwd(), "supabase/functions/gpu-video/index.ts"), "utf8"),
);

describe("who may call", () => {
  it("admin is a view, not the gate — no blanket refusal remains", () => {
    expect(EDGE).toContain("const isAdmin = adminFlag === true");
    expect(EDGE).not.toContain('"forbidden"');
  });

  it("the audio production switch still governs every caller", () => {
    expect(EDGE).toContain('if (request.audio === "narration" && cfg.audio_enabled !== true)');
  });
});

describe("the privacy boundary", () => {
  it("a user's status read is scoped to their own rows", () => {
    expect(EDGE).toContain('select(isAdmin ? "*" : USER_JOB_COLUMNS)');
    expect(EDGE).toContain('isAdmin ? jobsQuery : jobsQuery.eq("created_by", userId)');
  });

  it("the user column set carries no operator fields", () => {
    const constDef = EDGE.slice(
      EDGE.indexOf("const USER_JOB_COLUMNS"),
      EDGE.indexOf(";", EDGE.indexOf("const USER_JOB_COLUMNS")),
    );
    expect(constDef.length).toBeGreaterThan(0);
    for (const operatorWord of [
      "runpod",
      "cost",
      "price",
      "reservation",
      "billed",
      "idempotency",
      "_ref",
      "created_by",
    ]) {
      expect(constDef, operatorWord).not.toContain(operatorWord);
    }
  });

  it("a user's poll advances only their own jobs — no cross-user race on the paid fork", () => {
    expect(EDGE).toContain("pollGenerations(admin, isAdmin ? null : userId)");
    const pollFn = EDGE.slice(
      EDGE.indexOf("async function pollGenerations"),
      EDGE.indexOf("Deno.serve"),
    );
    expect(pollFn).toContain('openQuery.eq("created_by", scopeUserId)');
  });

  it("a signed URL is issued only to the job's own creator (or the operator)", () => {
    const signCase = EDGE.slice(EDGE.indexOf('case "sign":'), EDGE.indexOf("default:"));
    expect(signCase).toContain('.eq("created_by", userId)');
    expect(signCase.indexOf('.eq("created_by", userId)')).toBeLessThan(
      signCase.indexOf("createSignedUrl"),
    );
  });
});

describe("the financial gates did not move", () => {
  it("kill switch → shared daily cap → validation → live-quote admission → one submit", () => {
    const submitFn = EDGE.slice(
      EDGE.indexOf("async function submitGeneration"),
      EDGE.indexOf("async function pollGenerations"),
    );
    const order = [
      "if (!cfg || cfg.enabled === false)",
      "if (usedToday >= cfg.daily_cap)",
      "const validated = validateRequest(raw)",
      "const admission = admitGeneration(price)",
      "await runpodSubmit(buildWorkerPayload(request, jobId))",
    ];
    let last = -1;
    for (const gate of order) {
      const at = submitFn.indexOf(gate);
      expect(at, gate).toBeGreaterThan(last);
      last = at;
    }
  });

  it("exactly two provider submissions exist: the video run and the voiced job's mux", () => {
    expect(EDGE.match(/await runpodSubmit\(/g)).toHaveLength(2);
  });
});

describe("no new egress rode in with the rollout", () => {
  it("every external call still goes through the timed fetch, five call sites", () => {
    expect(EDGE.match(/fetchWithTimeout\(/g)).toHaveLength(5);
    expect(EDGE).toContain('"https://api.runpod.io/graphql"');
    expect(EDGE).toContain('"https://api.runpod.ai/v2"');
  });

  it("no external video or AI provider is named", () => {
    const flat = EDGE.toLowerCase();
    for (const host of [
      "runwayml",
      "googleapis",
      "generativelanguage",
      "gemini",
      "kling",
      "lumalabs",
      "pika.art",
    ]) {
      expect(flat, host).not.toContain(host);
    }
  });
});

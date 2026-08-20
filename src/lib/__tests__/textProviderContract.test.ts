/**
 * The provider fabric as a REAL contract over the live text client — not merely
 * a registry that describes intentions.
 *
 * modelRegistry.ts declares which model each text path uses; _shared/llm.ts is
 * the client that actually calls it. Before this test the two had already
 * drifted: the registry labelled claude-sonnet-4-6 the "callClaude default"
 * while llm.ts defaults to `opts.model ?? "claude-opus-5"`, and the successful
 * job 11d02818 (which passed no model) really ran on opus-5. A registry a router
 * cannot trust is scaffolding; this pins the registry's declared text routing to
 * the literals in the live client so the fabric can never again describe a
 * provider path the code does not take.
 *
 * It asserts EQUIVALENCE to the existing behaviour — it changes no model choice
 * (model/tier selection is owner-gated). If a future change wants a different
 * default, it updates BOTH the client and the registry, and this test is where
 * the two are proven to agree.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_REGISTRY,
  TEXT_FALLBACK,
  TEXT_PRIMARY,
  TEXT_TOOLS,
  selectByCapability,
} from "../../../supabase/functions/_shared/modelRegistry.ts";

const LLM = readFileSync(join(process.cwd(), "supabase/functions/_shared/llm.ts"), "utf8");

describe("the registry's declared text routing matches the live llm.ts client", () => {
  it("callClaude's DEFAULT model is the id the registry declares (TEXT_TOOLS)", () => {
    // The live default: `model: opts.model ?? "claude-opus-5"`.
    expect(TEXT_TOOLS.id).toBe("claude-opus-5");
    expect(LLM).toContain(`opts.model ?? "${TEXT_TOOLS.id}"`);
  });

  it("the Gemini fallback model is the id the registry declares (TEXT_FALLBACK)", () => {
    expect(TEXT_FALLBACK.id).toBe("gemini-3.6-flash");
    expect(LLM).toContain(`const GEMINI_FALLBACK_MODEL = "${TEXT_FALLBACK.id}"`);
  });

  it("the sonnet baseline is an explicit-opt-in model, not the default", () => {
    // TEXT_PRIMARY exists for callers that pass it (translate, health-scan); it
    // must NOT be the string the client falls back to when no model is given.
    expect(TEXT_PRIMARY.id).toBe("claude-sonnet-4-6");
    expect(LLM).not.toContain(`opts.model ?? "${TEXT_PRIMARY.id}"`);
  });
});

describe("selectByCapability is usable as the text router", () => {
  it("returns the current text providers, none shut down", () => {
    const hits = selectByCapability({ modality: "text" });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.every((m) => m.capabilities.modality === "text")).toBe(true);
    expect(hits.every((m) => m.status !== "shutdown")).toBe(true);
  });

  it("surfaces the model the client actually defaults to, and its fallback", () => {
    const ids = selectByCapability({ modality: "text" }).map((m) => m.id);
    expect(ids).toContain(TEXT_TOOLS.id); // the live callClaude default (opus-5)
    expect(ids).toContain(TEXT_FALLBACK.id); // the gemini fallback
  });

  it("keeps every text entry pointed at _shared/llm.ts", () => {
    // The registry's usedBy is where a human learns which client a model rides;
    // every text model must name the shared client so the map stays honest.
    for (const m of MODEL_REGISTRY.filter((e) => e.capabilities.modality === "text")) {
      expect(m.usedBy, `${m.id} usedBy`).toMatch(/llm\.ts/);
    }
  });
});

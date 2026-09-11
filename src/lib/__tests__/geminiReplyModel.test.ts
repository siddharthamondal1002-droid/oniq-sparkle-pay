/**
 * A TRANSLATED GEMINI REPLY MUST NAME THE MODEL THAT WAS ACTUALLY CALLED.
 *
 * `translateGeminiResponseToAnthropic` used to stamp every reply with the
 * constant `gemini-fallback/${GEMINI_FALLBACK_MODEL}` — a value it could
 * compute without being told anything, because it was never told anything. So
 * a reply from the PINNED `gemini-3.1-flash-lite` came back labelled
 * `gemini-fallback/gemini-3.6-flash`: the retired model the September bill
 * blamed for 41.3% of spend, and the one every call site was pinned away from
 * on 2026-09-05. The pin was never broken. The label was.
 *
 * It went eleven days unnoticed because this function had NO TEST AT ALL —
 * one definition, one call site, nothing asserting the label either way.
 *
 * Two readers make it more than a wrong string:
 *
 *   engine.ts          prices with it, so no Gemini call was ever priceable
 *                      and the ESTIMATE was charged for all of them — 4.7x the
 *                      real figure on the first measured tap ($0.006748
 *                      charged against $0.001440 of Google).
 *   translate-message  writes it into `message_translations.engine`, i.e. into
 *                      a column the next bill investigation would read.
 *
 * BEHAVIOURAL, NOT A SOURCE READ, and deliberately so: this repo has a shelf of
 * receipts for assertions that matched the comment explaining the code. The
 * module imports three local `.ts` siblings and touches `Deno` only inside
 * function bodies, so vitest can load it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/sourceText";
import {
  TEXT_DIRECT_HEAVY,
  TEXT_DIRECT_STANDARD,
} from "../../../supabase/functions/_shared/modelRegistry.ts";
import { actualUsd, isPriced } from "../../../supabase/functions/_shared/oqcaRuntime/pricing.ts";

/**
 * LOADED AT RUNTIME, NOT IMPORTED — AND THE INDIRECTION IS THE POINT.
 *
 * `tsconfig.json` includes `src/**` only, so a static import from here would
 * pull `llm.ts` into the browser program's typecheck, where its three `Deno.`
 * references have no declaration and `npx tsc --noEmit` goes red. Measured: of
 * ~80 `_shared` modules reachable from `src/`, exactly three name `Deno`
 * (`llm.ts`, `financialLedger.ts`, `googleAuth.ts`) and NOT ONE is statically
 * imported by any `src/` file. That boundary is real and this test does not get
 * to be the first thing to cross it.
 *
 * A non-literal specifier is opaque to `tsc` and resolved by vite at run time,
 * so the assertions below exercise the REAL module — which matters more here
 * than usual: the defect they exist to catch is a value, and this repo has a
 * shelf of receipts for source reads that matched the comment instead.
 */
const LLM = "../../../supabase/functions/_shared/llm.ts";
let translateGeminiResponseToAnthropic: (gem: unknown, model: string) => { [k: string]: any };

beforeAll(async () => {
  const mod = await import(/* @vite-ignore */ LLM);
  translateGeminiResponseToAnthropic = mod.translateGeminiResponseToAnthropic;
});

/** The shape Google actually returns, trimmed to what the translator reads. */
const geminiBody = {
  candidates: [{ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
};

/** The id that was retired, and that this function used to claim on every call. */
const RETIRED = "gemini-3.6-flash";

describe("a translated Gemini reply names the model that answered", () => {
  it("reports the id it was handed, not a constant", () => {
    // TWO DIFFERENT INPUTS, TWO DIFFERENT OUTPUTS. One assertion alone would
    // pass against a constant that happened to equal the expected id; it is
    // the pair that proves the value travels.
    expect(translateGeminiResponseToAnthropic(geminiBody, TEXT_DIRECT_STANDARD.id).model).toBe(
      TEXT_DIRECT_STANDARD.id,
    );
    expect(translateGeminiResponseToAnthropic(geminiBody, TEXT_DIRECT_HEAVY.id).model).toBe(
      TEXT_DIRECT_HEAVY.id,
    );
  });

  it("never claims the retired fallback model, for any caller", () => {
    for (const id of [TEXT_DIRECT_STANDARD.id, TEXT_DIRECT_HEAVY.id, "anything-at-all"]) {
      const label = String(translateGeminiResponseToAnthropic(geminiBody, id).model);
      expect(label).not.toContain(RETIRED);
      expect(label).not.toContain("gemini-fallback/");
    }
  });

  it("still carries the usage the ledger settles on", () => {
    const reply = translateGeminiResponseToAnthropic(geminiBody, TEXT_DIRECT_STANDARD.id);
    expect(reply.usage.input_tokens).toBe(100);
    expect(reply.usage.output_tokens).toBe(20);
  });
});

describe("the label is what decides whether a call can be priced", () => {
  it("prices a standard-tier answer for real", () => {
    const reply = translateGeminiResponseToAnthropic(geminiBody, TEXT_DIRECT_STANDARD.id);
    expect(isPriced(String(reply.model))).toBe(true);
    // 100 in at $0.25/MTok + 20 out at $1.50/MTok.
    expect(actualUsd(String(reply.model), reply.usage)).toBeCloseTo(100 * 2.5e-7 + 20 * 1.5e-6, 12);
  });

  it("could not price the old constant, which is the defect in one line", () => {
    expect(isPriced(`gemini-fallback/${RETIRED}`)).toBe(false);
    expect(actualUsd(`gemini-fallback/${RETIRED}`, { input_tokens: 100, output_tokens: 20 })).toBe(
      null,
    );
  });

  it("leaves the unpriced path REAL rather than dead, on the heavy tier", () => {
    // `actualUsd` returning null must stay reachable — the caller's fallback to
    // the estimate is a live branch, not vestigial. The heavy tier's id is
    // genuinely absent from MODEL_RATES, so it is the honest fixture for that
    // branch now that the fictional `gemini-fallback/…` one is gone.
    const reply = translateGeminiResponseToAnthropic(geminiBody, TEXT_DIRECT_HEAVY.id);
    expect(isPriced(String(reply.model))).toBe(false);
    expect(actualUsd(String(reply.model), reply.usage)).toBe(null);
  });
});

/**
 * THE GUARD IS THE CALL SITE, NOT THE PARAMETER.
 *
 * The behavioural tests above prove the function reports what it is handed.
 * They cannot see what `callGemini` hands it — and handing it
 * `GEMINI_FALLBACK_MODEL` would restore the whole defect with the new
 * signature intact and every test above still green. That is the 2026-09-05
 * lesson in this same file: a default is not a decision, and only the call site
 * can carry one.
 *
 * Comments stripped, because the paragraph explaining this quotes the constant
 * it bans.
 */
describe("callGemini hands over the model it actually called", () => {
  const src = stripComments(
    readFileSync(join(process.cwd(), "supabase/functions/_shared/llm.ts"), "utf8"),
  );

  it("passes `geminiModel`, the resolved id, and not the fallback constant", () => {
    expect(src).toMatch(/translateGeminiResponseToAnthropic\(parsed,\s*geminiModel\)/);
    expect(src).not.toMatch(/translateGeminiResponseToAnthropic\([^)]*GEMINI_FALLBACK_MODEL/);
  });

  it("keeps no constant model label anywhere in the translated body", () => {
    // The literal is gone from the module entirely: `GEMINI_FALLBACK_MODEL`
    // survives only as `callGemini`'s internal default, which is deliberate —
    // deleting it turns a forgotten model into a crash rather than an
    // expensive success, and that is a different change.
    expect(src).not.toMatch(/gemini-fallback/);
    expect(src).toMatch(/const geminiModel = opts\.geminiModel \?\? GEMINI_FALLBACK_MODEL;/);
  });
});

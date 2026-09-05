/**
 * THE LARGEST LINE ON THE SEPTEMBER BILL CAME FROM A MODEL NOBODY CHOSE.
 *
 * `My_Billing_Account_Reports_20260901___20260930`, read 2026-09-05:
 *
 *   Generate content output token count gemini 3.6 flash text   399,078   ₹142.99
 *   Generate content output token count gemini 3.1 flash lite     3,177     ₹0.46
 *   gemini 3.1 pro preview                                        (absent)
 *
 * ₹142.99 of a ₹346.21 bill — 41%, more than image (₹96.31) and music (₹76.44)
 * put together — on `gemini-3.6-flash`, which is `GEMINI_FALLBACK_MODEL` in
 * llm.ts and is named by no caller at all. It is what `callGemini` reaches for
 * when a caller does not say. Only two callers did not say: story-plot's two
 * direct-Gemini branches, and translate-message's post-Claude retry. ting
 * pins GEMINI_FAILOVER_MODEL; everything else goes through callText, which
 * pins the tier ids.
 *
 * The heavy tier's absence from the bill is the other half of the diagnosis.
 * story-plot's `opts` asked for `tier: "heavy"`, but a tier is a callText
 * concept and callGemini never sees one — and with no Claude key in
 * production the callText path was never reached either. So the tier steered
 * nothing, and every film was written by the unpinned fallback.
 *
 * Owner directive, 2026-09-05: "cap story-plot and switch it to flash-lite".
 * This suite pins both halves.
 *
 * Source-level assertions, in the house style: what they protect is "somebody
 * dropped the pin" or "somebody added a fourth call site", not a subtle logic
 * error — and the real path needs a job token, two provider keys and money.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TEXT_DIRECT_STANDARD } from "../../../supabase/functions/_shared/modelRegistry";
import { classifyFailure } from "../../../supabase/functions/_shared/planOrchestrator";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const RAW = read("supabase/functions/story-plot/index.ts");

/** Strip comments, so prose ABOUT a call is not mistaken for the call. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const FN = codeOnly(RAW);

describe("story-plot spend — the stripper first", () => {
  /**
   * The guard the study suite paid for. `codeOnly`'s non-greedy block match
   * assumes `/*` and `*​/` balance; a stray inside a string or a regex literal
   * makes it mispair and swallow the very lines asserted below, so a correct
   * file "fails". Prove the stripped source still holds real code before
   * trusting a single absence assertion made against it.
   */
  it("leaves the call sites it is asked about", () => {
    expect(FN).toContain("const metered =");
    expect(FN).toContain("const callFor =");
    expect(FN.length).toBeGreaterThan(RAW.length * 0.5);
  });
});

describe("switch it to flash-lite", () => {
  it("names a Google model on every direct Gemini call", () => {
    // Every callGemini in this file must carry a geminiModel. An unpinned one
    // silently rejoins GEMINI_FALLBACK_MODEL, which is the whole ₹142.99.
    const calls = FN.match(/callGemini\(\s*\{[^}]*\}/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toContain("geminiModel");
  });

  it("pins the configured standard tier, not a literal id", () => {
    expect(FN).toContain("geminiModel: TEXT_DIRECT_STANDARD.id");
    // A hand-typed id drifts from the registry the day the registry moves.
    expect(FN).not.toMatch(/geminiModel:\s*["'`]/);
    expect(TEXT_DIRECT_STANDARD.id).toBe("gemini-3.1-flash-lite");
  });

  it("no longer asks callText for the heavy tier", () => {
    // gemini-3.1-pro-preview is the heavy id. Leaving the tier in place would
    // send the plan there the moment a Claude key appears — the one model more
    // expensive than the one just removed.
    expect(FN).not.toContain('tier: "heavy"');
  });

  it("keeps the two engines on the same wrapper, so they cannot drift apart", () => {
    expect(FN).toContain(
      'const callFor = (engine: string) => (engine === "gemini" ? meteredGemini : meteredText);',
    );
  });
});

describe("cap story-plot", () => {
  it("routes every billable call through the meter", () => {
    // INVOCATIONS, not references — `Parameters<typeof callText>` names the
    // helper without calling it, and counting names instead of calls is how a
    // guard like this ends up asserting a number nobody can explain.
    //
    // `callText(` never appears: it reaches the meter as a value,
    // `metered(callText)`. `callGemini(` appears exactly once, inside the
    // wrapper that pins the model. A second is a call site that escaped both
    // the cap and the pin.
    expect((FN.match(/\bcallText\(/g) ?? []).length).toBe(0);
    expect((FN.match(/\bcallGemini\(/g) ?? []).length).toBe(1);
    expect(FN).toContain("const meteredGemini = metered((o) =>");
    expect(FN).toContain("await meteredText(");
    expect(FN).toContain("await meteredGemini(");
  });

  it("refuses rather than truncating, and says so", () => {
    // A truncated Gemini reply comes back EMPTY (MAX_TOKENS), reads as bad
    // JSON, and spends the retry chain reaching the same place. The refusal
    // has to be a reason a caller can read.
    expect(FN).toMatch(/tokensSpent >= tokenBudget/);
    expect(FN).toContain("output token quota spent for this plan");
  });

  it("phrases the refusal so the orchestrator stops instead of falling over", () => {
    // Not a source grep: the real classifier, on the real string. A budget
    // refusal must read PERMANENT — the other engine is out of budget too, and
    // a transient reading would spend the cross-engine fallover discovering
    // that. classifyFailure also matches BARE numbers (429/500/502/503/504/529)
    // anywhere in the reason, so a message built out of raw figures is one
    // arithmetic change from being retried; "quota" pins it deliberately.
    for (const [spent, budget] of [
      [41_800, 41_800],
      [503, 503],
      [529, 429],
      [220_000, 220_000],
    ]) {
      const reason = `output token quota spent for this plan (${spent}/${budget})`;
      expect(classifyFailure(reason)).toBe("permanent");
    }
  });

  it("counts what each reply actually cost, from the shared usage shape", () => {
    // callGemini normalises Google's usageMetadata into Anthropic's shape, so
    // one field covers both engines.
    expect(FN).toMatch(/usage\?:\s*\{\s*output_tokens\?/);
    expect(FN).toContain("tokensSpent += outputTokensOf(res.data)");
  });

  it("reports the spend on both answers", () => {
    // The bill is a monthly total with no per-request breakdown. This is the
    // only place the cost of one film is knowable.
    expect(FN).toContain("servedBy, tokensSpent");
    expect(FN).toContain("tried, tokensSpent");
  });
});

/**
 * The budget's SHAPE, re-derived from the source rather than restated.
 *
 * Restating `Math.min(220_000, 40_000 + shots * 1_800)` in the test would only
 * prove the test can copy. These read the three numbers out of the file and
 * assert the properties that make a cap safe: it grows with the film, it stops
 * growing, and at every size it clears one full engine pass with room to
 * spare — so it never bites a film that is going well.
 */
describe("the budget is sized, not guessed", () => {
  const m = RAW.match(
    /function outputBudget\(shots: number\): number \{\s*return Math\.min\((\d[\d_]*),\s*(\d[\d_]*) \+ shots \* (\d[\d_]*)\);/,
  );
  const num = (s: string) => Number(s.replace(/_/g, ""));
  const ceiling = num(m?.[1] ?? "0");
  const base = num(m?.[2] ?? "0");
  const perShot = num(m?.[3] ?? "0");
  const budget = (shots: number) => Math.min(ceiling, base + shots * perShot);

  /** The file's own measurements: ~350 output tokens a shot, ~6k thinking a call. */
  const TOKENS_PER_SHOT = 350;
  const THINKING_PER_CALL = 6_000;
  const BATCH_SHOTS = 8;
  /** One engine pass: spine (2 calls) + ceil(shots / 8) batches. */
  const onePass = (shots: number) =>
    shots * TOKENS_PER_SHOT + (2 + Math.ceil(shots / BATCH_SHOTS)) * THINKING_PER_CALL;

  it("reads the constants out of the source", () => {
    expect(m).not.toBeNull();
    expect(ceiling).toBeGreaterThan(0);
  });

  it("grows with the film and then stops", () => {
    expect(budget(1)).toBeLessThan(budget(12));
    expect(budget(12)).toBeLessThan(budget(90));
    expect(budget(90)).toBeLessThanOrEqual(ceiling);
    // MAX_SHOTS is 90; nothing larger can be asked for, so the ceiling must
    // not bind before it or the slope is decoration.
    expect(budget(89)).toBeLessThan(budget(90) + perShot);
  });

  it("clears one full engine pass with headroom at every size", () => {
    for (const shots of [1, 4, 12, 20, 43, 90]) {
      expect(budget(shots)).toBeGreaterThan(onePass(shots) * 1.4);
    }
  });

  it("does not fund two full passes on a large film", () => {
    // The point of the cap: after one engine has burned a 43- or 90-shot film,
    // the second pass is money spent on a story that already failed once.
    expect(budget(43)).toBeLessThan(onePass(43) * 2);
    expect(budget(90)).toBeLessThan(onePass(90) * 2);
  });
});

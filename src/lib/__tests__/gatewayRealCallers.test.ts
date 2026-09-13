/**
 * THE REAL CALLERS, not the seam.
 *
 * `gatewayCreditLedger.test.ts` proves the ledger helpers behave. It cannot
 * prove that anything USES them — and for one review cycle nothing did: the
 * bindings were optional and every production call site still passed nothing,
 * so story-still, story-plot and story-voice recorded not one row while the
 * accounting was reported as complete. That is this repository's
 * most-recorded failure, and these assertions exist so it cannot recur
 * silently.
 *
 * Read as SOURCE rather than executed, deliberately: these are Deno edge
 * functions that import `Deno.env`, so importing them into vitest would drag
 * three `Deno.` references into the browser program (measured — it is why
 * `geminiReplyModel.test.ts` resolves its specifier through a variable). What
 * a source read can still prove is the thing that was actually wrong: that the
 * call sites pass a binding at all, that the id is fresh per attempt, and that
 * the identity is the server's own.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Comments quote the code they explain — every guard here would otherwise
 * match the paragraph above the line instead of the line. Eleven prose
 * matches in this repo say so.
 *
 * LINE COMMENTS COME OFF FIRST, and the order is not cosmetic: story-voice
 * carries `// ... for google/*-tts the ...`, whose `/*` opened a false block
 * comment that swallowed 80% of the file. Every assertion below then read an
 * almost-empty string and three of them failed against correct source — the
 * strip, not the code, was the thing that was wrong.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const STILL = code("supabase/functions/story-still/index.ts");
const PLOT = code("supabase/functions/story-plot/index.ts");
const VOICE = code("supabase/functions/story-voice/index.ts");
const RESCUE = code("supabase/functions/_shared/storyIrRescue.ts");

describe("story-still books every gateway draw", () => {
  it("passes a spend binding at both gateway call sites", () => {
    const calls = STILL.match(/drawStillViaGateway\(/g) ?? [];
    expect(calls.length).toBe(2);
    expect((STILL.match(/spend:\s*\{/g) ?? []).length).toBe(2);
    expect((STILL.match(/rpc:\s*serviceRoleRpc\(\)/g) ?? []).length).toBe(2);
  });

  it("mints a NEW request id per draw, so a redraw is a second row", () => {
    // A constant or job-derived id would make the second draw a duplicate of
    // the first and the second charge would vanish.
    const ids = STILL.match(/requestId: `story-still:\$\{crypto\.randomUUID\(\)\}`/g) ?? [];
    expect(ids.length).toBe(2);
  });

  it("labels the row with the job the signed token named, never a client field", () => {
    expect((STILL.match(/jobId: auth\.jobId \?\? null/g) ?? []).length).toBe(2);
    expect(STILL).not.toMatch(/jobId:\s*body[.?]/);
  });
});

describe("story-plot books the credit-spending rung", () => {
  it("hands the IR rescue a binding built from server-derived identity", () => {
    expect(RESCUE).toMatch(/spend\?:\s*RescueSpend/);
    expect(PLOT).toMatch(/spend:\s*\{[\s\S]*?rpc: serviceRoleRpc\(\)/);
    expect(PLOT).toMatch(/jobId: caller\.jobId/);
    expect(PLOT).toMatch(/userId: caller\.userId/);
  });

  it("derives the caller from the signed token or the auth service", () => {
    // Never from the request body: a caller-supplied user id would let anyone
    // book their spend against somebody else.
    expect(PLOT).toMatch(/type PlotCaller/);
    expect(PLOT).toMatch(/caller instanceof Response/);
  });

  it("counts each repair pass as its own attempt", () => {
    // One rescue can call the model twice (generate, then repair). Sharing one
    // request id would record one charge for two calls.
    expect(RESCUE).toMatch(/crypto\.randomUUID\(\)/);
    expect(RESCUE).toMatch(/attempt/);
  });
});

describe("story-voice books the inline TTS call", () => {
  it("captures before the provider is reached, in characters", () => {
    expect(VOICE).toMatch(/captureGatewaySpend\(/);
    expect(VOICE).toMatch(/unit: "characters"/);
    expect(VOICE).toMatch(/capability: "TTS"/);
  });

  it("captures AFTER validation, so a rejected request records nothing", () => {
    const capture = VOICE.indexOf("captureGatewaySpend(");
    const tooLong = VOICE.indexOf("That line is too long.");
    const nothing = VOICE.indexOf("Nothing to read.");
    expect(tooLong).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(tooLong);
    expect(capture).toBeGreaterThan(nothing);
  });

  it("settles a refusal as REJECTED, never NOT_CALLED", () => {
    // A 402 or 429 REACHED the gateway. The absence of a receipt is not proof
    // of a zero charge, so it cannot be recorded as a call that never happened.
    expect(VOICE).toMatch(/outcome: res\.status === 402 \|\| res\.status === 429 \? "REJECTED"/);
    expect(VOICE).not.toMatch(/"NOT_CALLED"/);
  });

  it("keeps raw provider text out of the ledger detail", () => {
    // Only a phase from the closed list and a numeric status may travel.
    const details = VOICE.match(/detail: \{[^}]*\}/g) ?? [];
    expect(details.length).toBeGreaterThan(0);
    for (const d of details) {
      expect(d).not.toMatch(/\bmessage\b|\be\.message\b|detailText/);
    }
  });

  it("reads the receipt the gateway named rather than inventing one", () => {
    expect(VOICE).toMatch(/providerReceiptFrom\(replyBody, res\.headers\)/);
  });

  it("uses the server's own identity for the row", () => {
    expect(VOICE).toMatch(/jobId: caller\.jobId/);
    expect(VOICE).toMatch(/userId: caller\.userId/);
    expect(VOICE).toMatch(/type VoiceCaller/);
  });
});

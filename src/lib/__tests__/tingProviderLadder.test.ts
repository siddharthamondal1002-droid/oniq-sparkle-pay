/**
 * TING'S LADDER — the wiring the pure tests cannot see.
 *
 * Provider ORDER, which secrets are read where, and whether every billable leg
 * holds a reservation are properties of the handler's source, and the real
 * paths need three provider keys and money. So this reads the deployed file,
 * with comments stripped first: the header of ting/index.ts explains the order
 * and the guard rule by naming both, and a grep that reads the explanation as
 * the code passes on the very file it exists to check.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const RAW = readFileSync(join(ROOT, "supabase/functions/ting/index.ts"), "utf8");
const CLIENT = readFileSync(join(ROOT, "src/routes/_authenticated/app.ai.tsx"), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const CODE = stripComments(RAW);

describe("the stripper first", () => {
  it("leaves the code it is asked about", () => {
    // The lesson this repo has paid for a dozen times: a stripper that
    // swallows the subject makes every assertion below vacuous.
    expect(CODE).toMatch(/Deno\.serve/);
    expect(CODE.length).toBeGreaterThan(RAW.length * 0.4);
  });
});

describe("provider order", () => {
  it("is OpenAI, then Gemini, then Claude — in that order, in one place", () => {
    const ladder = CODE.match(/for \(const leg of \[([^\]]+)\]\)/);
    expect(ladder, "the ladder must be one ordered list, not scattered branches").toBeTruthy();
    expect(ladder![1].replace(/\s/g, "")).toBe("legOpenAi,legGemini,legClaude");
  });

  it("names each provider's own leg exactly once", () => {
    for (const leg of [
      "async function legOpenAi",
      "async function legGemini",
      "async function legClaude",
    ]) {
      expect(CODE.split(leg).length - 1, leg).toBe(1);
    }
  });

  it("reaches the OpenAI Responses API, not chat completions", () => {
    expect(CODE).toContain("https://api.openai.com/v1/responses");
    expect(CODE).not.toContain("/v1/chat/completions");
  });
});

describe("secrets are server-side only", () => {
  it("reads all three keys from the edge runtime's environment", () => {
    for (const name of ["OPENAI_API_KEY", "GOOGLE_AI_API_KEY", "ANTHROPIC_API_KEY"]) {
      expect(CODE, `${name} must be read from Deno.env`).toMatch(
        new RegExp(`env\\("${name}"\\)|Deno\\.env\\.get\\("${name}"\\)`),
      );
    }
  });

  it("never puts a key into a log line or a response body", () => {
    // Scoped to what FOLLOWS `console.` / `json(` on the line, because the
    // first draft banned the identifier anywhere on such a line and so flagged
    // `if (!openAiKey && …) return json({ configured: false })` — a presence
    // check, not a leak. A ban wide enough to catch the whole line catches the
    // wrong thing; the window is the argument list.
    const KEYS = /openAiKey|geminiKey|claudeKey|API_KEY/;
    for (const line of CODE.split("\n")) {
      const at = Math.max(line.indexOf("console."), line.indexOf("json("));
      if (at < 0) continue;
      expect(line.slice(at), `a key must not reach this argument: ${line.trim()}`).not.toMatch(
        KEYS,
      );
    }
    // And the one place a key IS allowed to go: the provider's own auth header.
    expect(CODE).toMatch(/authorization:\s*`Bearer \$\{openAiKey\}`/);
  });

  it("tells the client only whether Ting is configured at all", () => {
    expect(CODE).toMatch(/configured:\s*false/);
    // The client contract is unchanged: reply, sources, configured, error.
    expect(CLIENT).toContain('supabase.functions.invoke("ting"');
    expect(CLIENT).toMatch(/sources\?:\s*string\[\]/);
    expect(CLIENT).not.toMatch(/OPENAI_API_KEY|TING_OPENAI_MODEL|api\.openai\.com/);
  });

  it("keeps the model override on the server", () => {
    expect(CODE).toMatch(/tingOpenAiModel\(env\)/);
    expect(CLIENT).not.toMatch(/tingOpenAiModel/);
  });
});

describe("every paid leg is behind the durable ledger", () => {
  it("guards the OpenAI leg against the financial ledger", () => {
    const leg = CODE.slice(
      CODE.indexOf("async function legOpenAi"),
      CODE.indexOf("async function legGemini"),
    );
    expect(leg).toMatch(/withProviderSpendGuard\(/);
    // The fetch must be INSIDE the guarded callback, so it cannot run before
    // admission and cannot skip settlement.
    expect(leg.indexOf("withProviderSpendGuard")).toBeLessThan(leg.indexOf("await fetch("));
    expect(leg).toMatch(/capability:\s*"TEXT"/);
    expect(leg).toMatch(/provider:\s*"openai"/);
  });

  it("guards the Gemini and Claude legs the way they always were", () => {
    const gemini = CODE.slice(
      CODE.indexOf("async function legGemini"),
      CODE.indexOf("async function legClaude"),
    );
    const claude = CODE.slice(CODE.indexOf("async function legClaude"));
    expect(gemini).toMatch(/withSearchSpendGuard\(/);
    expect(claude).toMatch(/withSearchSpendGuard\(/);
    expect(gemini.indexOf("withSearchSpendGuard")).toBeLessThan(gemini.indexOf("callGemini("));
  });

  it("fails CLOSED: a refusal stops the ladder instead of buying a second call", () => {
    // Turning "the ceiling said no" into "ask someone else" is how a guard
    // refusal becomes a bill, and it would make the owner's cap meaningless.
    expect(CODE).toMatch(/if \(r\.kind === "refused"\) \{[\s\S]{0,200}?break;/);
    // A missing ledger client refuses rather than skipping — withProviderSpendGuard
    // and withSearchSpendGuard both return guard-unavailable for a null rpc.
    expect(CODE).toMatch(/serviceRoleRpc\(\)/);
  });

  it("gives each leg its own request id", () => {
    expect(CODE).toMatch(/openAiRequestId\(baseRequestId\)/);
    expect(CODE).toMatch(/geminiRequestId\(baseRequestId\)/);
    expect(CODE).toMatch(/requestId:\s*baseRequestId/);
  });

  it("settles a 200-with-no-text as spend, not as an answer", () => {
    expect(CODE).toMatch(/r\.ok && answer\.reply \? \("ACCEPTED"/);
  });
});

describe("the fallback does not invent live sources", () => {
  it("sends Gemini no search tool and reserves no searches", () => {
    const gemini = CODE.slice(
      CODE.indexOf("async function legGemini"),
      CODE.indexOf("async function legClaude"),
    );
    expect(gemini).toMatch(/maxSearches:\s*0/);
    expect(gemini).not.toMatch(/tools:/);
  });
});

describe("the answer allowance", () => {
  it("is 2048 output tokens, with the reservation raised to match", () => {
    expect(CODE).toMatch(/TING_MAX_TOKENS\s*=\s*2048/);
    expect(CODE).toMatch(/TING_OUTPUT_TOKEN_RESERVE\s*=\s*3_600/);
    // The reserve must stay ABOVE the allowance: reasoning and control tokens
    // are billed as output without appearing in the answer.
    expect(3_600).toBeGreaterThan(2048);
  });
});

describe("what was preserved", () => {
  it("keeps auth, the rate limit, the language instruction and attachments", () => {
    expect(CODE).toMatch(/requireAuth\(req\)/);
    expect(CODE).toMatch(/_rateLimit\(_subFromAuth\(req\), 10\)/);
    expect(CODE).toMatch(/langInstruction\(lang\)/);
    expect(CODE).toMatch(/attachmentTokenCeiling\(/);
  });

  it("keeps crisis routing on the client, before any model call", () => {
    expect(CLIENT).toMatch(/guardTingPrompt\(text\)/);
    expect(CLIENT.indexOf("guardTingPrompt(text)")).toBeLessThan(
      CLIENT.indexOf('supabase.functions.invoke("ting"'),
    );
  });

  it("keeps the request lock", () => {
    expect(CLIENT).toMatch(/askInFlight\.current/);
  });
});

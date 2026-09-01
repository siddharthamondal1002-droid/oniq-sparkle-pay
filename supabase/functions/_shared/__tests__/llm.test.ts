/**
 * The Gemini fallback must never hand Google an array where a string belongs.
 *
 * THIS IS A REGRESSION FILE FOR A PRODUCTION OUTAGE. `ClaudeMessage.content`
 * was typed `string`, but Anthropic accepts content BLOCKS as well, and two
 * callers send them: study-paper-grade when a student photographs a handwritten
 * answer, study-tutor when a message carries an image or PDF. Both wrote
 * `as any` at the call site to get past the type — the signal that the type was
 * wrong, not the callers.
 *
 * While Anthropic was answering, nothing broke: it accepts the array natively.
 * The moment the billing-exhaustion fallback fired, translateMessagesToGemini
 * copied that array straight into `parts[0].text`, and Gemini answered:
 *
 *   HTTP 400 — Unknown name "text" at 'contents[0].parts[0]':
 *   Proto field is not repeating, cannot start list.
 *
 * So the assertion that matters is not "the text is right", it is
 * `typeof part.text === "string"` for EVERY part of EVERY message. A test that
 * only checked the happy string case would have passed throughout the outage.
 */
import { describe, expect, it, afterEach } from "vitest";
import {
  type ClaudeMessage,
  callGemini,
  GEMINI_MIN_OUTPUT_TOKENS,
  GEMINI_THINKING_HEADROOM_TOKENS,
  geminiOutputCeiling,
  geminiPartsFor,
  normalizeGeminiText,
  translateMessagesToGemini,
} from "../llm.ts";

/** The shape Gemini actually requires, asserted rather than assumed. */
type GeminiContent = { role: string; parts: Record<string, unknown>[] };

/**
 * The single property this whole file exists to defend.
 *
 * NOTE WHAT IT DOES AND DOES NOT SAY. It used to require every part to carry a
 * string `text`, which was right while the bridge was text-only and became
 * WRONG once attachments were made to cross properly — an `inlineData` part
 * legitimately has no `text` at all. The invariant that actually prevents the
 * original 400 is narrower: no part may carry a `text` that is not a string.
 * That is the thing Gemini's scalar proto field rejects, and it is still
 * asserted on every part of every message.
 *
 * Checked structurally rather than by spot-checking `[0].parts[0]`, because
 * the failure was positional: one message in a conversation carried the
 * attachment and the rest were plain strings.
 */
function expectEveryPartIsGeminiValid(contents: unknown[]) {
  expect(contents.length).toBeGreaterThan(0);
  for (const [i, c] of contents.entries()) {
    const msg = c as GeminiContent;
    expect(Array.isArray(msg.parts), `message ${i} has no parts array`).toBe(true);
    expect(msg.parts.length, `message ${i} has no parts`).toBeGreaterThan(0);
    for (const [j, part] of msg.parts.entries()) {
      if ("text" in part) {
        expect(
          typeof part.text,
          `contents[${i}].parts[${j}].text is ${
            Array.isArray(part.text) ? "an array" : typeof part.text
          } — Gemini 400s on anything but a string`,
        ).toBe("string");
        expect(Array.isArray(part.text)).toBe(false);
      } else {
        // The only other legal part shape.
        const inline = part.inlineData as { mimeType?: unknown; data?: unknown } | undefined;
        expect(inline, `contents[${i}].parts[${j}] is neither text nor inlineData`).toBeTruthy();
        expect(typeof inline?.mimeType).toBe("string");
        expect(typeof inline?.data).toBe("string");
      }
    }
  }
}

describe("normalizeGeminiText", () => {
  it("1. leaves a plain string untouched", () => {
    expect(normalizeGeminiText("hello world")).toBe("hello world");
    expect(normalizeGeminiText("")).toBe("");
  });

  it("2. extracts the text from a single Anthropic text block", () => {
    expect(normalizeGeminiText([{ type: "text", text: "just the one" }])).toBe("just the one");
  });

  it("3. joins multiple text blocks", () => {
    expect(
      normalizeGeminiText([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  it("4. keeps the text and drops the image, rather than 400ing on either", () => {
    // The real shape study-paper-grade sends. The image cannot cross to Gemini
    // — inlineData is a different format — so the honest outcome is that the
    // model reads the question without the photograph, not that the whole
    // request fails.
    const graded = [
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
      { type: "text", text: "Read the attached answer and grade it." },
    ];
    expect(normalizeGeminiText(graded)).toBe("Read the attached answer and grade it.");
  });

  it("preserves bare string blocks", () => {
    expect(normalizeGeminiText(["raw", { type: "text", text: "block" }])).toBe("raw\nblock");
  });

  it("5. turns an empty array into an empty string", () => {
    expect(normalizeGeminiText([])).toBe("");
  });

  it('6. turns null and undefined into an empty string, not "null"', () => {
    // String(null) is "null", and a model handed the literal word "null" reads
    // it as something the user typed.
    expect(normalizeGeminiText(null)).toBe("");
    expect(normalizeGeminiText(undefined)).toBe("");
  });

  it("stringifies an unexpected primitive rather than dropping it", () => {
    expect(normalizeGeminiText(42)).toBe("42");
    expect(normalizeGeminiText(true)).toBe("true");
  });

  it("survives blocks with no text at all", () => {
    expect(normalizeGeminiText([{ type: "tool_use", id: "x", name: "f", input: {} }])).toBe("");
    expect(normalizeGeminiText([null, undefined, {}])).toBe("");
  });

  it("ignores a non-string `text` field instead of passing it through", () => {
    // The bug in miniature: a nested array must not survive into parts[].text.
    expect(normalizeGeminiText([{ type: "text", text: ["nested"] }])).toBe("");
  });
});

describe("translateMessagesToGemini never emits a non-string part", () => {
  it("1. handles plain string content", () => {
    const contents = translateMessagesToGemini([{ role: "user", content: "hi" }]).contents;
    expectEveryPartIsGeminiValid(contents);
    expect((contents[0] as GeminiContent).parts[0].text).toBe("hi");
  });

  it("4. handles mixed text and non-text blocks — the exact production payload", () => {
    const contents = translateMessagesToGemini([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBOR" } },
          { type: "text", text: "What is wrong with my working?" },
        ],
      },
    ]).contents;
    expectEveryPartIsGeminiValid(contents);
    // THE IMAGE CROSSES NOW. It used to be dropped, which for a chat message
    // was arguably tolerable and for study-paper-grade was not — that function
    // photographs a handwritten answer and asks for a mark, so a dropped photo
    // means marking work the model never saw.
    const p0 = (contents[0] as GeminiContent).parts;
    expect(p0).toHaveLength(2);
    expect(p0[0].inlineData).toEqual({ mimeType: "image/png", data: "iVBOR" });
    expect(p0[1].text).toBe("What is wrong with my working?");
  });

  it("7. handles structured ASSISTANT content, and still maps the role to model", () => {
    // Role conversion is existing behaviour and must survive the fix.
    const contents = translateMessagesToGemini([
      { role: "assistant", content: [{ type: "text", text: "Because x = 4." }] },
    ]).contents;
    expectEveryPartIsGeminiValid(contents);
    expect((contents[0] as GeminiContent).role).toBe("model");
    expect((contents[0] as GeminiContent).parts[0].text).toBe("Because x = 4.");
  });

  it("keeps user as user", () => {
    const contents = translateMessagesToGemini([{ role: "user", content: "q" }]).contents;
    expect((contents[0] as GeminiContent).role).toBe("user");
  });

  it("holds across a whole conversation where only one turn is structured", () => {
    // The positional failure: a spot check of parts[0] would have missed this.
    const convo: ClaudeMessage[] = [
      { role: "user", content: "first question" },
      { role: "assistant", content: "an answer" },
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: "JVB" },
          },
          { type: "text", text: "and this one is from the PDF" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "structured reply" }] },
    ];
    const contents = translateMessagesToGemini(convo).contents;
    expectEveryPartIsGeminiValid(contents);
    expect(contents).toHaveLength(4);
    const withPdf = (contents[2] as GeminiContent).parts;
    expect(withPdf[0].inlineData).toEqual({ mimeType: "application/pdf", data: "JVB" });
    expect(withPdf[1].text).toBe("and this one is from the PDF");
  });

  it("emits a string part even for empty and null content", () => {
    const contents = translateMessagesToGemini([
      { role: "user", content: [] },
      { role: "user", content: null as unknown as string },
      { role: "user", content: undefined as unknown as string },
    ]).contents;
    expectEveryPartIsGeminiValid(contents);
  });
});

/**
 * 8. The end-to-end fallback, against the body that actually goes on the wire.
 *
 * The helpers above prove the translation; this proves the REQUEST. It stubs
 * Deno.env and fetch, calls callGemini exactly as callGeminiFallback does, and
 * inspects the JSON that would have reached Google — which is where the 400
 * was raised, and the only place systemInstruction can be checked too.
 */
describe("a forced tool call that never arrives is named, not silently empty", () => {
  const realFetch = globalThis.fetch;
  const hadDeno = "Deno" in globalThis;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (!hadDeno) delete (globalThis as Record<string, unknown>).Deno;
  });

  function stubReturning(candidate: unknown) {
    (globalThis as Record<string, unknown>).Deno = { env: { get: () => "test-key" } };
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [candidate], usageMetadata: {} }),
    })) as unknown as typeof fetch;
  }

  const forced = {
    system: "s",
    messages: [{ role: "user" as const, content: "make the section" }],
    tools: [{ name: "emit", description: "d", input_schema: { type: "object" } }],
    toolChoice: { type: "tool", name: "emit" },
    maxTokens: 1800,
  };

  it("reports WHY when Gemini answers prose instead of calling the tool", async () => {
    // This is study-paper-generate's "mcq: no items" at its source. The caller
    // could only report the symptom; the cause lives here.
    stubReturning({
      content: { parts: [{ text: "Sure! Here are ten questions..." }] },
      finishReason: "STOP",
    });
    const res = await callGemini(forced);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("gemini-no-tool-call finish=STOP");
  });

  it("names MAX_TOKENS specifically, which is the thinking-budget failure", async () => {
    // The one the headroom exists to prevent — it must be tellable apart from
    // every other reason a tool call might not arrive.
    stubReturning({ content: { parts: [] }, finishReason: "MAX_TOKENS" });
    const res = await callGemini(forced);
    expect(res.ok === false && res.reason).toBe("gemini-no-tool-call finish=MAX_TOKENS");
  });

  it("still succeeds when the tool call DOES arrive", async () => {
    stubReturning({
      content: { parts: [{ functionCall: { name: "emit", args: { mcq: [1, 2] } } }] },
      finishReason: "STOP",
    });
    const res = await callGemini(forced);
    expect(res.ok).toBe(true);
  });

  it("does not fire for callers that never forced a tool", async () => {
    // Ting asks for prose. Prose is the correct answer there.
    stubReturning({ content: { parts: [{ text: "hello" }] }, finishReason: "STOP" });
    const res = await callGemini({ system: "s", messages: [{ role: "user", content: "hi" }] });
    expect(res.ok).toBe(true);
  });
});

describe("geminiOutputCeiling", () => {
  it("never sends less than the floor, however small the caller's budget", () => {
    // study-paper-generate gives its mcq section 1,800 tokens — sized for
    // Anthropic, where max_tokens bounds the ANSWER. On Gemini that same number
    // is shared with thinking, and ~6k of thoughts leaves nothing.
    for (const asked of [1, 256, 1024, 1800, 3600, 6000]) {
      expect(geminiOutputCeiling(asked)).toBeGreaterThanOrEqual(GEMINI_MIN_OUTPUT_TOKENS);
    }
  });

  it("scales above the floor for a caller that genuinely wants more", () => {
    expect(geminiOutputCeiling(20000)).toBe(20000 + GEMINI_THINKING_HEADROOM_TOKENS);
  });

  it("is always strictly more than the caller asked for", () => {
    // The invariant. Equalling it would recreate the bug.
    for (const asked of [1, 1024, 1800, 16384, 50000]) {
      expect(geminiOutputCeiling(asked)).toBeGreaterThan(asked);
    }
  });

  it("copes with a missing or nonsense budget", () => {
    expect(geminiOutputCeiling(undefined)).toBeGreaterThanOrEqual(GEMINI_MIN_OUTPUT_TOKENS);
    expect(geminiOutputCeiling(0)).toBeGreaterThanOrEqual(GEMINI_MIN_OUTPUT_TOKENS);
    expect(geminiOutputCeiling(-5)).toBeGreaterThanOrEqual(GEMINI_MIN_OUTPUT_TOKENS);
  });
});

describe("thinking headroom", () => {
  const realFetch = globalThis.fetch;
  const hadDeno = "Deno" in globalThis;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (!hadDeno) delete (globalThis as Record<string, unknown>).Deno;
  });

  it("asks Gemini for more than the caller's budget, to cover thoughts", async () => {
    // Anthropic's max_tokens bounds the ANSWER; Gemini 3.x draws its thinking
    // from the same allowance. Passing the number through unchanged is how a
    // 1,800-token section ends at MAX_TOKENS with no tool call at all.
    (globalThis as Record<string, unknown>).Deno = { env: { get: () => "test-key" } };
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
            usageMetadata: {},
          }),
      };
    }) as unknown as typeof fetch;

    await callGemini({ system: "s", messages: [{ role: "user", content: "q" }], maxTokens: 1800 });
    const cfg = sent.generationConfig as { maxOutputTokens: number };
    expect(cfg.maxOutputTokens).toBe(geminiOutputCeiling(1800));
    // The number that matters: comfortably above the ~6k of thoughts Google's
    // own issue tracker reports on simple tasks, so a forced tool call is
    // emitted rather than truncated into nothing.
    expect(cfg.maxOutputTokens).toBeGreaterThanOrEqual(16384);
  });
});

describe("mime types Gemini will not accept", () => {
  /**
   * BOTH PICKERS OFFER GIF. app.ai.tsx and app.study.tsx both list
   * `image/gif` in their accept attribute, and Anthropic takes it happily.
   * Gemini does not accept GIF as inlineData at all, so posting one would turn
   * a working Anthropic request into a hard Gemini 400 — the fallback failing
   * on precisely the request that needed a fallback.
   */
  it("treats a GIF as uncrossable rather than posting it and being rejected", () => {
    const { parts, dropped } = geminiPartsFor([
      { type: "image", source: { type: "base64", media_type: "image/gif", data: "R0lGOD" } },
      { type: "text", text: "what is this?" },
    ]);
    expect(dropped).toBe(1);
    expect(parts).toEqual([{ text: "what is this?" }]);
  });

  it("accepts the types Gemini documents, and only those", () => {
    for (const mime of ["image/png", "image/jpeg", "image/webp", "application/pdf"]) {
      const { dropped } = geminiPartsFor([
        { type: "image", source: { type: "base64", media_type: mime, data: "AAAA" } },
      ]);
      expect(dropped, `${mime} should cross`).toBe(0);
    }
    for (const mime of ["image/gif", "image/bmp", "image/tiff", "video/mp4", "text/html"]) {
      const { dropped } = geminiPartsFor([
        { type: "image", source: { type: "base64", media_type: mime, data: "AAAA" } },
      ]);
      expect(dropped, `${mime} should NOT cross`).toBe(1);
    }
  });
});

describe("callGemini refuses rather than answering about an unseen attachment", () => {
  const realFetch = globalThis.fetch;
  const hadDeno = "Deno" in globalThis;
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (!hadDeno) delete (globalThis as Record<string, unknown>).Deno;
  });

  it("refuses when an attachment cannot cross, and never calls Google", async () => {
    // The failure this whole bridge was rewritten to prevent: a confident
    // answer to a question about a picture the model was never sent.
    (globalThis as Record<string, unknown>).Deno = { env: { get: () => "test-key" } };
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      throw new Error("must not reach Google");
    }) as unknown as typeof fetch;

    const res = await callGemini({
      system: "grade it",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/gif", data: "R0lGOD" } },
            { type: "text", text: "Grade the attached answer." },
          ],
        },
      ],
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe("attachment-untranslatable");
    expect(called, "it must refuse BEFORE spending a call").toBe(false);
  });
});

describe("attachments cross to Gemini instead of vanishing", () => {
  /**
   * THE REGRESSION THAT MATTERS MOST IN THIS FILE.
   *
   * study-paper-grade photographs a student's handwritten answer and asks for
   * a mark. study-tutor sends homework photos. health-scan sends a medical
   * report. If the blob is dropped on the way to Gemini, none of those degrade
   * gracefully — they produce a grade, an explanation or a health summary for
   * a document the model was never shown. That is a fabricated answer wearing
   * a real one's clothes, and it is worse than an outage.
   */
  it("inlines a base64 image rather than dropping it", () => {
    const { parts, dropped } = geminiPartsFor([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
      { type: "text", text: "Grade this." },
    ]);
    expect(dropped).toBe(0);
    expect(parts).toEqual([
      { inlineData: { mimeType: "image/jpeg", data: "AAAA" } },
      { text: "Grade this." },
    ]);
  });

  it("inlines a base64 PDF too", () => {
    const { parts } = geminiPartsFor([
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0" },
      },
      { type: "text", text: "Summarise this report." },
    ]);
    expect(parts[0]).toEqual({ inlineData: { mimeType: "application/pdf", data: "JVBERi0" } });
  });

  it("COUNTS what it cannot inline instead of silently discarding it", () => {
    // A URL source has no inline equivalent. The count is what lets a caller
    // refuse rather than answer blind — silence is what caused this bug.
    const { parts, dropped } = geminiPartsFor([
      { type: "image", source: { type: "url", url: "https://example.test/x.png" } },
      { type: "text", text: "What is this?" },
    ]);
    expect(dropped).toBe(1);
    expect(parts).toEqual([{ text: "What is this?" }]);
  });

  it("keeps a plain string as one text part", () => {
    expect(geminiPartsFor("hello")).toEqual({ parts: [{ text: "hello" }], dropped: 0 });
  });

  it("always emits at least one part, even for empty content", () => {
    // Gemini rejects a content entry with no parts at all.
    for (const empty of [[], null, undefined, ""]) {
      const { parts } = geminiPartsFor(empty);
      expect(parts.length).toBeGreaterThan(0);
    }
  });

  it("puts the instruction after the attachment it refers to", () => {
    // "the answer is in the attached photo" only makes sense following it.
    const { parts } = geminiPartsFor([
      { type: "text", text: "first" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "Zm9v" } },
      { type: "text", text: "second" },
    ]);
    expect(parts[0]).toHaveProperty("inlineData");
    expect(parts[1]).toEqual({ text: "first\nsecond" });
  });
});

describe("Claude → Gemini fallback with structured content", () => {
  const realFetch = globalThis.fetch;
  const hadDeno = "Deno" in globalThis;

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (!hadDeno) delete (globalThis as Record<string, unknown>).Deno;
  });

  function stub(): { body: () => Record<string, unknown> } {
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (k: string) => (k === "GOOGLE_AI_API_KEY" ? "test-key" : undefined) },
    };
    let sent: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
            usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
          }),
      };
    }) as unknown as typeof fetch;
    return { body: () => sent };
  }

  it("sends string parts for a structured message, and succeeds", async () => {
    const { body } = stub();
    const res = await callGemini({
      system: "You are a grader.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
            { type: "text", text: "Grade this answer out of 5." },
          ],
        },
      ],
      maxTokens: 256,
    });

    expect(res.ok, "the fallback itself must not fail").toBe(true);
    const sent = body();
    expectEveryPartIsGeminiValid(sent.contents as unknown[]);
    const parts = (sent.contents as GeminiContent[])[0].parts;
    // The photo reaches Google, and the instruction that refers to it follows.
    // Before this, the image was dropped and Gemini was asked to grade a
    // handwritten answer it had never been shown.
    expect(parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: "AAAA" });
    expect(parts[1].text).toBe("Grade this answer out of 5.");
  });

  it("keeps systemInstruction a string too", () => {
    // Same scalar proto field, one line away in the same request body.
    const { body } = stub();
    return callGemini({
      system: "plain system prompt",
      messages: [{ role: "user", content: "q" }],
    }).then(() => {
      const sys = (body().systemInstruction as { parts: { text: unknown }[] }).parts[0].text;
      expect(typeof sys).toBe("string");
      expect(sys).toBe("plain system prompt");
    });
  });

  it("would have FAILED before the fix — the array reached parts[].text", () => {
    // Mutation check, kept as documentation of what regressing looks like: the
    // pre-fix expression was `parts: [{ text: m.content }]`.
    const preFix = [{ role: "user", parts: [{ text: [{ type: "text", text: "x" }] }] }];
    expect(() => expectEveryPartIsGeminiValid(preFix)).toThrow();
  });
});

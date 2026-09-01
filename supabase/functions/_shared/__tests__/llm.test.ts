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
  normalizeGeminiText,
  translateMessagesToGemini,
} from "../llm.ts";

/** The shape Gemini actually requires, asserted rather than assumed. */
type GeminiContent = { role: string; parts: { text: unknown }[] };

/**
 * The single property this whole file exists to defend.
 *
 * Checked structurally — every message, every part — rather than by spot-
 * checking `[0].parts[0]`, because the failure was positional: one message in a
 * conversation carried the attachment and the rest were plain strings.
 */
function expectEveryPartIsAString(contents: unknown[]) {
  expect(contents.length).toBeGreaterThan(0);
  for (const [i, c] of contents.entries()) {
    const msg = c as GeminiContent;
    expect(Array.isArray(msg.parts), `message ${i} has no parts array`).toBe(true);
    for (const [j, part] of msg.parts.entries()) {
      expect(
        typeof part.text,
        `contents[${i}].parts[${j}].text is ${
          Array.isArray(part.text) ? "an array" : typeof part.text
        } — Gemini 400s on anything but a string`,
      ).toBe("string");
      expect(Array.isArray(part.text)).toBe(false);
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
    const contents = translateMessagesToGemini([{ role: "user", content: "hi" }]);
    expectEveryPartIsAString(contents);
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
    ]);
    expectEveryPartIsAString(contents);
    expect((contents[0] as GeminiContent).parts[0].text).toBe("What is wrong with my working?");
  });

  it("7. handles structured ASSISTANT content, and still maps the role to model", () => {
    // Role conversion is existing behaviour and must survive the fix.
    const contents = translateMessagesToGemini([
      { role: "assistant", content: [{ type: "text", text: "Because x = 4." }] },
    ]);
    expectEveryPartIsAString(contents);
    expect((contents[0] as GeminiContent).role).toBe("model");
    expect((contents[0] as GeminiContent).parts[0].text).toBe("Because x = 4.");
  });

  it("keeps user as user", () => {
    const contents = translateMessagesToGemini([{ role: "user", content: "q" }]);
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
    const contents = translateMessagesToGemini(convo);
    expectEveryPartIsAString(contents);
    expect(contents).toHaveLength(4);
    expect((contents[2] as GeminiContent).parts[0].text).toBe("and this one is from the PDF");
  });

  it("emits a string part even for empty and null content", () => {
    const contents = translateMessagesToGemini([
      { role: "user", content: [] },
      { role: "user", content: null as unknown as string },
      { role: "user", content: undefined as unknown as string },
    ]);
    expectEveryPartIsAString(contents);
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
    expectEveryPartIsAString(sent.contents as unknown[]);
    expect((sent.contents as GeminiContent[])[0].parts[0].text as string).toBe(
      "Grade this answer out of 5.",
    );
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
    expect(() => expectEveryPartIsAString(preFix)).toThrow();
  });
});

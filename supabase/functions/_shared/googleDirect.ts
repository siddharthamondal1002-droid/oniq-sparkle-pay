// googleDirect — ONE way to call Google's own API, for every feature that
// does, on GOOGLE_AI_API_KEY.
//
// OWNER DIRECTIVE, 2026-09-04b: "make images, Voice, music, documents direct
// Gemini not via lovable". Image, TTS and text move off ai.gateway.lovable.dev
// onto generativelanguage.googleapis.com — the route Veo clips and Lyria music
// already take. That directive is recorded in full in modelRegistry.ts,
// including what it changes about the bill; this file is only the plumbing.
//
// WHY A SHARED MODULE RATHER THAN A FOURTH COPY. music-generate, story-clip
// and llm.ts each grew their own `fetch(generativelanguage…)` with their own
// URL string, their own error read and their own token pull. Three copies is
// where the differences hide: one of them reads `usageMetadata`, another
// reads `usage`, and only one of them decodes Google's error envelope, so the
// other two log "upstream 400" and throw the message away. Adding image and
// voice as copies four and five would make that worse. Everything new goes
// through here.
//
// WHAT THIS FILE DOES NOT DO. It does not decide which model, does not touch
// the spend ledger, and does not retry. Retries are deliberately absent
// everywhere in this codebase: a prompt Google refuses is refused identically
// the second time, and a loop is how a month of budget disappears in an hour.
// The caller wraps this in withProviderSpendGuard and stays the one place
// that admits or refuses a charge.

/** Google's generative endpoint. v1beta because that is where these ids live. */
const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** A Google `parts` entry — text, or inline base64 media. */
export type GooglePart = { text: string } | { inlineData: { mimeType: string; data: string } };

export type GoogleCallResult = {
  ok: boolean;
  status: number;
  data: unknown;
  /** Google's own error message when it sent one, for the user-facing reason. */
  errorMessage: string | null;
  /** "timeout" | "network" when the request never got an HTTP status. */
  transport: "timeout" | "network" | null;
};

/**
 * POST one generateContent call.
 *
 * The KEY GOES IN THE QUERY STRING, not a bearer header — that is what this
 * upstream accepts and what the working music path does. The body is Google's
 * NATIVE shape with an explicit role; the OpenAI field names this endpoint is
 * often given (`prompt`, `input`, `messages`) come back as
 * "Unknown name …: Cannot find field", measured on the music path.
 */
export async function googleGenerateContent(opts: {
  model: string;
  key: string;
  parts: GooglePart[];
  /** ["IMAGE"] or ["AUDIO"]; omitted entirely for ordinary text. */
  responseModalities?: string[];
  /** Merged into generationConfig — e.g. speechConfig for a TTS voice. */
  generationConfig?: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<GoogleCallResult> {
  const generationConfig: Record<string, unknown> = { ...(opts.generationConfig ?? {}) };
  if (opts.responseModalities) generationConfig.responseModalities = opts.responseModalities;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: opts.parts }],
  };
  // An EMPTY generationConfig is omitted rather than sent as {}. Sending an
  // empty object is accepted today, but the endpoint has rejected unknown and
  // malformed config shapes before, and there is no reason to send a field
  // that says nothing.
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  try {
    const res = await fetch(
      `${BASE}/models/${encodeURIComponent(opts.model)}:generateContent?key=${encodeURIComponent(opts.key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: opts.signal,
      },
    );
    // READ THE ERROR BODY. A non-2xx from this endpoint carries
    // {error:{code,message,status}} and the message is the only thing that
    // distinguishes "that model id does not exist" from "your prompt was
    // refused" from "quota". Throwing it away is what left the music path
    // logging a bare status for months.
    const parsed = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? parsed : null,
      errorMessage: res.ok ? null : googleErrorMessage(parsed),
      transport: null,
    };
  } catch (e) {
    const timedOut = (e as Error)?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: null,
      transport: timedOut ? "timeout" : "network",
    };
  }
}

/** Google's error envelope, or null when the body was not one. */
export function googleErrorMessage(parsed: unknown): string | null {
  const m = (parsed as { error?: { message?: unknown } })?.error?.message;
  return typeof m === "string" && m.length > 0 ? m : null;
}

/** Every part of the first candidate, or an empty list. */
function partsOf(data: unknown): unknown[] {
  const parts = (data as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates?.[0]
    ?.content?.parts;
  return Array.isArray(parts) ? parts : [];
}

/**
 * The first inline part whose mime starts with `prefix` ("image/", "audio/").
 *
 * The mime passes through UN-NORMALIZED, because it carries information the
 * caller needs: an audio mime says its sample rate
 * ("audio/L16;codec=pcm;rate=24000") and a WAV wrap is wrong without it, and
 * an image mime decides the stored file's extension.
 */
export function firstInlinePart(
  data: unknown,
  prefix: string,
): { mime: string; data: string } | null {
  for (const part of partsOf(data)) {
    const inline = (part as { inlineData?: { mimeType?: string; data?: string } })?.inlineData;
    if (typeof inline?.data === "string" && inline.data.length > 0) {
      const mime = inline.mimeType ?? "";
      if (mime.startsWith(prefix)) return { mime, data: inline.data };
    }
  }
  return null;
}

/** The concatenated text parts, for an ordinary text call. */
export function joinedText(data: unknown): string {
  return partsOf(data)
    .map((p) => (p as { text?: unknown })?.text)
    .filter((t): t is string => typeof t === "string")
    .join("");
}

/**
 * Input/output tokens from `usageMetadata`.
 *
 * Recorded for PROVENANCE, not for settlement. Google's reply carries token
 * counts but no cost field, and this account's actual rate is whatever the
 * billing page says — so the ledger charges its flat reservation and keeps
 * these in `detail`. Writing a dollar figure derived from a published list
 * price would be inventing a number, which is the thing the ledger exists to
 * stop.
 */
export function googleUsage(data: unknown): { inputTokens: number; outputTokens: number } | null {
  const meta = (data as { usageMetadata?: Record<string, unknown> })?.usageMetadata;
  if (!meta) return null;
  const num = (v: unknown) => (typeof v === "number" ? v : 0);
  return {
    inputTokens: num(meta.promptTokenCount),
    // candidatesTokenCount misses the audio/image half on some replies, where
    // the total is the only complete figure; prefer the difference when the
    // total is bigger than the parts, the same arithmetic searchBudget does.
    outputTokens: Math.max(
      num(meta.candidatesTokenCount),
      num(meta.totalTokenCount) - num(meta.promptTokenCount),
    ),
  };
}

/**
 * The diagnostic has to survive to the screen.
 *
 * Both failures this guards against were real and both cost a production
 * diagnosis on 2026-09-01: Ting collapsed six distinct server errors into one
 * toast, and Study threw away a `reason` it had already parsed. On the same day
 * the Supabase log pipeline stopped returning rows, which is what turned an
 * annoyance into the only remaining evidence being gone.
 */
import { describe, expect, it } from "vitest";
import { edgeErrorMessage, withReason } from "@/lib/edgeError";

/** What supabase-js actually throws: a useless message, the truth on .context. */
function functionsHttpError(status: number, body: unknown) {
  const e = new Error("Edge Function returned a non-2xx status code") as Error & {
    context?: Response;
  };
  e.context = new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
  return e;
}

describe("edgeErrorMessage", () => {
  it("prefers the server's `error` over the supabase-js placeholder", async () => {
    const e = functionsHttpError(502, { error: "Ting glitched — try again" });
    expect(await edgeErrorMessage(e)).toBe("Ting glitched — try again");
  });

  it("reads `reason` too, which is the study functions' convention", async () => {
    const e = functionsHttpError(200, { source: "unavailable", reason: "mcq: http 400" });
    expect(await edgeErrorMessage(e)).toBe("mcq: http 400");
  });

  it("NEVER returns the non-2xx placeholder, which is the whole bug", async () => {
    // The pre-fix behaviour was to show this string, or something derived from
    // it, for every distinct failure. It must never be what a caller displays.
    const e = new Error("Edge Function returned a non-2xx status code");
    expect(await edgeErrorMessage(e)).toBe("");
  });

  it("does not consume the body, so anything downstream can still read it", async () => {
    const e = functionsHttpError(500, { error: "boom" });
    await edgeErrorMessage(e);
    // If the helper had read the original rather than a clone, this throws.
    await expect(e.context!.json()).resolves.toEqual({ error: "boom" });
  });

  it("falls back to a real Error message when there is no response body", async () => {
    expect(await edgeErrorMessage(new Error("Failed to fetch"))).toBe("Failed to fetch");
  });

  it("survives a non-JSON body rather than throwing over it", async () => {
    const e = new Error("Edge Function returned a non-2xx status code") as Error & {
      context?: Response;
    };
    e.context = new Response("<html>502 Bad Gateway</html>", { status: 502 });
    expect(await edgeErrorMessage(e)).toBe("");
  });

  it("survives junk it was never designed for", async () => {
    expect(await edgeErrorMessage(null)).toBe("");
    expect(await edgeErrorMessage(undefined)).toBe("");
    expect(await edgeErrorMessage("a string")).toBe("");
    expect(await edgeErrorMessage({ context: "not a Response" })).toBe("");
  });

  it("ignores an empty or whitespace-only server message", async () => {
    expect(await edgeErrorMessage(functionsHttpError(500, { error: "   " }))).toBe("");
    expect(await edgeErrorMessage(functionsHttpError(500, { error: 42 }))).toBe("");
  });
});

describe("withReason", () => {
  it("keeps the human sentence first and the machine reason in brackets", () => {
    // Not the raw reason alone: "mcq: http 400" is the right thing for a bug
    // report and the wrong thing to show a student unaccompanied.
    expect(withReason("couldn't build that paper — try again 🌿", "mcq: http 400")).toBe(
      "couldn't build that paper — try again 🌿 (mcq: http 400)",
    );
  });

  it("leaves the sentence alone when there is no reason to add", () => {
    const friendly = "couldn't build that paper — try again 🌿";
    expect(withReason(friendly, undefined)).toBe(friendly);
    expect(withReason(friendly, null)).toBe(friendly);
    expect(withReason(friendly, "")).toBe(friendly);
    expect(withReason(friendly, "   ")).toBe(friendly);
  });
});

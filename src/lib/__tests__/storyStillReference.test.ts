/**
 * story-still and the owner-asset reference — what the in-house engine
 * does with it, which is refuse it honestly.
 *
 * HISTORY, kept because it is the reason this file's rules exist. Under
 * the gateway (2026-08-20 capability probe) a reference image inlined as
 * a data: URL conditioned the generation and held identity, and two
 * guards made that safe: only an inlined data:image/*;base64 URL was ever
 * accepted — never an external http(s) URL a model could crawl — under a
 * size cap.
 *
 * FULLY IN-HOUSE DIRECTIVE, 2026-08-27. The still now comes from ONIQ's
 * own GPU worker, whose image_generate op is text-only, so conditioning
 * is not available. The guards are not weakened by that — they are
 * SUPERSEDED by something stricter: EVERY reference is refused, so no
 * reference of any shape reaches any model. What must never happen is the
 * quiet version, drawing an unconditioned frame while the caller believes
 * it was conditioned; the refusal is a 422, which is exactly the caller's
 * own step-down signal, and its ask ladder drops the reference and asks
 * again — which is how a film stays alive.
 *
 * The in-house route BACK to conditioning is recorded next to the refusal
 * in the function: a character asset the engine itself drew, addressed by
 * its key — not an inlined upload, because the bucket's write credentials
 * live in the endpoint alone.
 *
 * story-still is a Deno edge function (it reads Deno.env and serves an
 * HTTP handler), so it cannot be imported into vitest; it is pinned by
 * source assertion, the repo's established discipline for edge functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "supabase/functions/story-still/index.ts"), "utf8");

describe("a reference is refused, never quietly ignored", () => {
  it("any reference at all stops the call with the caller's step-down code", () => {
    const at = SRC.indexOf("referenceImage");
    expect(at).toBeGreaterThan(-1);
    const block = SRC.slice(at, at + 700);
    expect(block).toMatch(/does not condition on a reference yet/);
    expect(block).toMatch(/422/);
  });

  it("no shape of reference is validated INTO the request — all are refused", () => {
    // The old guards allowed a data: URL through. Nothing goes through now,
    // so the request body must carry the prompt and nothing else.
    const call = SRC.slice(SRC.indexOf("generateStill("), SRC.indexOf("generateStill(") + 400);
    expect(call).not.toMatch(/referenceImage/);
  });

  it("the engine's own contract is text-only, so nothing can smuggle bytes in", () => {
    const engine = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/oniqImage.ts"),
      "utf8",
    );
    expect(engine).toMatch(/params:\s*\{\s*prompt\s*\}/);
    expect(engine).not.toMatch(/input_key/);
  });

  it("an external http(s) URL still cannot reach a model — now by construction", () => {
    // The original guard's whole point, preserved: this function may open a
    // socket only to ONIQ's own endpoint.
    for (const url of SRC.match(/https?:\/\/[^"'`\s]+/g) ?? []) {
      expect(url, url).toMatch(/^https:\/\/(api\.runpod\.ai|\$\{)|auth\/v1\/user/);
    }
  });
});

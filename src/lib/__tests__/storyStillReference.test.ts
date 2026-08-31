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
 * FULLY IN-HOUSE DIRECTIVE, 2026-08-27. The still moved to ONIQ's own GPU
 * worker, whose image_generate op was text-only, so conditioning was not
 * available and EVERY reference was refused.
 *
 * THE ROUTE BACK, TAKEN 2026-08-31 — and it is the one this file already
 * predicted: "a character asset the engine itself drew, addressed by its
 * key — not an inlined upload, because the bucket's write credentials live
 * in the endpoint alone."
 *
 * So the rules below did not relax; they got SHARPER. Inline bytes are
 * still refused, in every shape, because there is still nowhere for them
 * to land. What is accepted instead is a NAME — the id of a published
 * canonical character — which this side resolves against a fixed
 * allowlist into a server-owned key, and which the GPU worker's own
 * contract re-validates before spending anything. The caller contributes
 * a name from a closed set and nothing else: no path, no URL, no bytes.
 *
 * What must never happen is still the quiet version — drawing an
 * unconditioned frame while the caller believes it was conditioned. That
 * is now impossible in a new way: the reply says whether the anchor was
 * actually used, and the renderer records the engine's answer rather than
 * its own request.
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
  it("inline bytes are still refused, in every shape", () => {
    const at = SRC.indexOf("referenceImage");
    expect(at).toBeGreaterThan(-1);
    const block = SRC.slice(at, at + 900);
    expect(block).toMatch(/Inline reference bytes are not accepted/);
    expect(block).toMatch(/422/);
    // And the refusal names the CAPABILITY, so the ask ladder cannot read it
    // as a verdict on the shot's content and step down to empty scenery.
    expect(block).toContain("CAPABILITY_MARKER");
  });

  it("the only reference the function accepts is a NAME it resolves itself", () => {
    // A path, a URL or a key from the caller would each be an authority to
    // read an object of their choosing. An id is not: it is looked up in a
    // fixed allowlist, and an id that is not a published canonical character
    // resolves to nothing.
    expect(SRC).toContain("characterRefKey(characterRefId)");
    expect(SRC).toContain('from "../_shared/characterRef.ts"');
    // Nothing in the function builds a key from caller text.
    expect(SRC).not.toMatch(/story\/ref\/\$\{/);
    expect(SRC).not.toMatch(/body\?\.(referenceKey|reference_key|refPath|refUrl)/);
  });

  it("an unresolvable id draws unanchored and says so — it is not an error", () => {
    // A capability gap must never make the prompt worse. An id with no
    // published frame is a shot without an anchor, which is what EVERY shot
    // was before this existed.
    expect(SRC).toContain("not-a-published-canonical-character");
    expect(SRC).toContain("referenceUnresolved");
    expect(SRC).toContain("conditioned: Boolean(referenceKey)");
  });

  it("no shape of BYTES is validated into the request", () => {
    // The old guards allowed a data: URL through, then everything was
    // refused. Now a key travels and bytes still never do.
    const at = SRC.indexOf("const still = await generateStill(");
    const call = SRC.slice(at, at + 700);
    expect(call).not.toMatch(/referenceImage/);
    expect(call).not.toMatch(/base64|data:/);
    expect(call).toContain("referenceKey");
  });

  it("the engine's own contract is text-only, so nothing can smuggle bytes in", () => {
    const engine = readFileSync(
      join(process.cwd(), "supabase/functions/_shared/oniqImage.ts"),
      "utf8",
    );
    // The image_generate params carry TEXT AND NUMBERS ONLY. `seed` and
    // `negative_prompt` joined `prompt` on 2026-08-31 — the first so ten
    // retries are ten different draws rather than one image ten times, the
    // second so a shot with a face is steered off malformed eyes rather than
    // off "inconsistent motion". Neither is a byte carrier, and the rule this
    // test exists for is unchanged: nothing that could hold an image may
    // appear in the request the engine is sent.
    // The params object itself — the op name legitimately contains "image".
    const op = engine.indexOf('op: "image_generate"');
    const body = engine.slice(engine.indexOf("params: {", op), engine.indexOf("});", op));
    expect(body).toMatch(/prompt,/);
    expect(body).toMatch(/seed: opts\.seed/);
    expect(body).toMatch(/negative_prompt: opts\.negativePrompt/);
    // BYTE CARRIERS, specifically. `reference_key` is now legitimately in
    // this object and is not one: it is a server-derived key the worker reads
    // with its own credentials, pinned by contract.py to the story/ref/
    // prefix. What must never appear is anything that could carry an IMAGE or
    // name an object of the caller's choosing.
    for (const carrier of [
      "input_key",
      "referenceImage",
      "base64",
      "data:",
      "http",
      "url",
    ]) {
      expect(body, carrier).not.toContain(carrier);
    }
    expect(body).toContain("reference_key: opts.referenceKey");
  });

  it("an external http(s) URL still cannot reach a model — now by construction", () => {
    // The original guard's whole point, preserved: this function may open a
    // socket only to ONIQ's own endpoint.
    for (const url of SRC.match(/https?:\/\/[^"'`\s]+/g) ?? []) {
      expect(url, url).toMatch(/^https:\/\/(api\.runpod\.ai|\$\{)|auth\/v1\/user/);
    }
  });
});

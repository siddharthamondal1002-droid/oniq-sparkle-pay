/**
 * story-still owner-asset conditioning — the adapter that makes a registered
 * character the visual source instead of a fresh face per shot.
 *
 * story-still is a Deno edge function (it reads Deno.env and serves an HTTP
 * handler), so it cannot be imported into vitest; it is pinned by source
 * assertion, the repo's established discipline for the edge functions. The
 * behaviour proven here is exactly what the 2026-08-20 capability probe
 * established against the live gateway: a reference image inlined as a
 * data: URL conditions the generation and holds identity, while a text-only
 * call stays byte-for-byte the previous behaviour.
 *
 * The two guards are the point — "use the owner asset, never source a new
 * face": only an inlined data:image/*;base64 URL is accepted (never an external
 * http(s) URL a model could crawl), under a size cap.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  join(process.cwd(), "supabase/functions/story-still/index.ts"),
  "utf8",
);

describe("story-still accepts an optional owner reference image", () => {
  it("reads a referenceImage field from the request body", () => {
    expect(SRC).toMatch(/body\?\.referenceImage/);
  });

  it("builds multimodal content ONLY when a reference is present, text-only otherwise", () => {
    // The ternary keeps the unconditioned path exactly as it was (a bare string
    // content) and adds the image_url part only when conditioning.
    expect(SRC).toMatch(/const content = referenceImage/);
    expect(SRC).toMatch(/type:\s*"image_url"/);
    expect(SRC).toMatch(/image_url:\s*\{\s*url:\s*referenceImage\s*\}/);
    expect(SRC).toMatch(/messages:\s*\[\{\s*role:\s*"user",\s*content\s*\}\]/);
  });
});

describe("the guards — owner bytes only, never an external URL", () => {
  it("rejects anything that is not an inlined data:image/*;base64 URL", () => {
    // The regex admits data: image URLs and nothing else; an http(s) URL (the
    // shape a Google/stock/web image would take) fails the check.
    expect(SRC).toMatch(/\^data:image\\\/\(png\|jpe\?g\|webp\);base64,/);
    expect(SRC).toMatch(/referenceImage must be an inlined data:image/);
  });

  it("caps the reference size so a giant payload cannot be smuggled through", () => {
    expect(SRC).toMatch(/const MAX_REFERENCE =/);
    expect(SRC).toMatch(/referenceImage\.length > MAX_REFERENCE/);
  });

  it("still parses the gateway's data[].b64_json reply the conditioning uses", () => {
    // The probe returned images in the data[].b64_json pocket; firstImage must
    // still read it, so conditioned and unconditioned replies land the same way.
    expect(SRC).toMatch(/b64_json/);
  });
});

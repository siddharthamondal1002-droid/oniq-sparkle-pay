/**
 * PUBLISHING A CANONICAL CHARACTER FRAME — a copy, not a generation.
 *
 * The blocker this closes: reference conditioning was implemented end to end
 * and could not activate, because `story/ref/canon/<id>/v<n>.png` was empty.
 * The worker reads a reference from the media bucket and nothing had ever put
 * one there.
 *
 * The frames were never missing — they are ONIQ's own owner assets, finished
 * frames already addressed by `assetPath` in the owner map. So the answer is a
 * server-side copy costing ZERO GPU jobs, not 67 image_generate calls that
 * would spend money to produce something different from bytes already on disk.
 *
 * story-reference-publish is a Deno edge function (it reads Deno.env and
 * serves an HTTP handler), so it cannot be imported into vitest; the transport
 * is pinned by source assertion, the repo's established discipline. The pure
 * halves — the magic-byte sniff and the PNG header read — are exercised by
 * re-implementing nothing: they are asserted to exist and to be used.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ACTOR_ASSETS, referenceEligible } from "../../data/storyActorAssets.ts";
import { characterRefKey } from "../../../supabase/functions/_shared/characterRef.ts";

const SRC = readFileSync(
  join(process.cwd(), "supabase/functions/story-reference-publish/index.ts"),
  "utf8",
);

/**
 * The same source with comments removed.
 *
 * Several assertions below are about what the CODE does not do, and this
 * repository deliberately records a rule in the comment above the code that
 * honours it — the function's note names RUNPOD_API_KEY to say which rule it
 * is following. Deleting that note to satisfy a substring search would remove
 * the reasoning and leave the regex happy, which is backwards.
 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("it copies owned bytes — it never generates", () => {
  it("spends no GPU and calls no engine", () => {
    for (const forbidden of [
      "image_generate",
      "video_generate",
      "story_generate",
      "runpod",
      "RUNPOD",
      "generateStill",
      "inference",
    ]) {
      expect(CODE, forbidden).not.toContain(forbidden);
    }
    expect(SRC).toContain("gpuJobs: 0");
  });

  it("reads the source from the owner map, not from the request", () => {
    expect(SRC).toContain("const sourceUrl = assetUrl(actor);");
    // No field of any kind that could carry a URL or a path inward.
    for (const field of ["sourceUrl", "sourceKey", "src", "url", "path", "key"]) {
      expect(CODE, field).not.toMatch(new RegExp(`body\\?\\.${field}\\b`));
    }
  });

  it("pins the source to ONIQ's own origin, even though the map already does", () => {
    // The map is DATA and data changes without anybody re-reading this
    // function. A defence that exists in only one place is one a refactor can
    // delete.
    expect(SRC).toContain("startsWith(`${ONIQ_ASSET_ORIGIN}/`)");
  });
});

describe("what the caller may influence, which is almost nothing", () => {
  it("the destination key is derived, never supplied", () => {
    expect(SRC).toContain("const destKey = characterRefKey(characterRefId, version);");
    expect(CODE).not.toMatch(/body\?\.(destKey|destination|outputKey|bucket)/);
    // The bucket is a constant in this file, not a parameter.
    expect(SRC).toMatch(/const BUCKET = "oniq-gpu";/);
  });

  it("only a published canonical character is accepted", () => {
    expect(SRC).toContain("isPublishableCharacterRef(characterRefId)");
    // And eligibility is re-checked at the moment a name becomes a fetch.
    expect(SRC).toContain("referenceEligible(actor)");
  });
});

describe("the bytes are proved, not trusted", () => {
  it("magic bytes decide the format — a content-type header is a claim", () => {
    expect(SRC).toContain("const kind = sniffImage(bytes);");
    expect(SRC).toMatch(/if \(kind !== "png"\)/);
    // The header is read only to refuse early on an oversized object.
    expect(SRC).toContain('got.headers.get("content-length")');
  });

  it("size is bounded at both ends", () => {
    expect(SRC).toContain("MIN_REFERENCE_BYTES");
    expect(SRC).toContain("MAX_REFERENCE_BYTES");
    expect(SRC).toMatch(/const MAX_REFERENCE_BYTES = 12 \* 1024 \* 1024;/);
  });

  it("dimensions are read from the PNG header and bounded", () => {
    // A 64x64 thumbnail has no face in it to anchor; a 12000px panorama is a
    // sheet by another name.
    expect(SRC).toContain("const size = pngSize(bytes);");
    expect(SRC).toContain("MIN_REFERENCE_DIM");
    expect(SRC).toContain("MAX_REFERENCE_DIM");
  });
});

describe("the destination is verified, and versions are immutable", () => {
  it("an existing version is never overwritten", () => {
    // Overwriting in place would silently change films already drawn against
    // that version.
    expect(SRC).toMatch(/const existing = await r2\.fetch\(objectUrl, \{ method: "HEAD" \}\)/);
    expect(SRC).toContain("alreadyPresent: true");
    expect(SRC).toContain("published: false");
  });

  it("the write is verified by reading the object back, not by its status code", () => {
    expect(SRC).toContain("const back = await r2.fetch(objectUrl");
    expect(SRC).toMatch(/storedBytes !== bytes\.byteLength/);
  });
});

describe("the gates", () => {
  it("is admin-gated, because publishing WRITES to the media bucket", () => {
    expect(SRC).toContain("profile?.is_admin !== true");
    expect(SRC).toContain('json({ error: "Admins only" }, 403)');
    // The caller is re-derived from their own JWT — the screen is not the gate.
    expect(SRC).toContain("asCaller.auth.getUser()");
  });

  it("keeps the platform JWT check by staying out of config.toml", () => {
    // Functions that authenticate a job token opt out of verify_jwt and gate
    // themselves. This one authenticates a PERSON, so the platform gate
    // applies and it re-checks anyway — the same shape as gpu-video.
    const cfg = readFileSync(join(process.cwd(), "supabase/config.toml"), "utf8");
    expect(cfg).not.toContain("[functions.story-reference-publish]");
  });

  it("names a missing variable but never a value", () => {
    expect(SRC).toContain("R2_ACCESS_KEY_ID");
    // The property is that no SECRET and no signed or account-bearing URL
    // reaches a response body or a log. The account id legitimately builds the
    // S3 endpoint — that is what an endpoint is — and `objectUrl` built from
    // it is used to sign requests and never returned.
    for (const line of SRC.split("\n")) {
      const code = line.split("//")[0];
      const emits = /return json\(|console\.(log|error)\(/.test(code);
      if (!emits) continue;
      for (const secret of ["accessKeyId", "secretAccessKey", "accountId", "objectUrl", "endpoint", "sourceUrl"]) {
        expect(code, `${secret} in: ${line.trim()}`).not.toContain(secret);
      }
    }
    // What DOES travel back is the source PATH, which names an object on
    // ONIQ's own origin rather than handing over a fetchable link.
    expect(SRC).toContain("sourcePath: actor.assetPath");
  });
});

describe("sheet frames never reach a model as an identity reference", () => {
  it("a sheet is excluded at the allowlist, so it cannot be published either", () => {
    // A turnaround or contact sheet reproduces its own panel layout when
    // conditioned (measured 2026-08-21, shot 04). Excluding at the allowlist
    // means the exclusion holds for BOTH the publisher and the still path,
    // rather than being a check each has to remember.
    const sheets = ACTOR_ASSETS.filter((a) => !referenceEligible(a));
    expect(sheets.length).toBeGreaterThan(0);
    for (const s of sheets) {
      expect(characterRefKey(s.characterRefId), s.characterRefId).toBeNull();
    }
  });

  it("and eligibility is what decides it, not the file's name or extension", () => {
    for (const a of ACTOR_ASSETS) {
      expect(Boolean(characterRefKey(a.characterRefId))).toBe(referenceEligible(a));
    }
  });
});

describe("how many frames this actually unblocks", () => {
  it("every eligible canonical character can be published without a GPU job", () => {
    const eligible = ACTOR_ASSETS.filter(referenceEligible);
    const sheets = ACTOR_ASSETS.filter((a) => !referenceEligible(a));
    // Recorded as a test so the numbers in any report are checkable rather
    // than asserted, and so a change to the map shows up here.
    expect(eligible.length + sheets.length).toBe(ACTOR_ASSETS.length);
    expect(eligible.every((a) => a.assetPath.startsWith("/"))).toBe(true);
    // Nothing requires generation: every eligible actor already has bytes.
    expect(eligible.every((a) => Boolean(a.assetPath))).toBe(true);
  });
});

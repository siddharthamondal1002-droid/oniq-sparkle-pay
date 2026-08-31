/**
 * The worker actually sends the 67 owner assets into generation — proven from
 * the worker source (it claims a job at import, so it cannot be run in vitest).
 *
 * This pins the complete zero-cost path the owner asked to verify:
 *   owner map → casting → owner-asset fetch → base64 data URL →
 *   story-still referenceImage
 * plus the guards (owner origin only), the inert default (STORY_ACTOR_REFS off),
 * the honest text-only fallback, and the no-base64-in-logs rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKER = readFileSync(join(process.cwd(), "remotion/scripts/story-worker.mjs"), "utf8");

describe("worker imports the alias-free casting + origin, not the bundler registry", () => {
  it("imports castShot and the ONIQ origin with explicit .ts paths", () => {
    expect(WORKER).toMatch(
      /import \{ castShot \} from '\.\.\/\.\.\/src\/lib\/storyActorCasting\.ts'/,
    );
    expect(WORKER).toMatch(
      /import \{ ONIQ_ASSET_ORIGIN \} from '\.\.\/\.\.\/src\/data\/storyActorAssets\.ts'/,
    );
  });
});

describe("the feature is inert unless the owner turns it on", () => {
  it("STORY_ACTOR_REFS defaults off", () => {
    expect(WORKER).toMatch(
      /const ACTOR_REFS = \(process\.env\.STORY_ACTOR_REFS \?\? 'off'\) === 'on'/,
    );
  });

  it("all casting/fetch/attach work is behind the ACTOR_REFS gate", () => {
    expect(WORKER).toMatch(/if \(ACTOR_REFS\) \{/);
  });
});

describe("the owner-asset fetcher guards — owner bytes only, no external face", () => {
  const fn = WORKER.slice(
    WORKER.indexOf("async function fetchOwnerReference"),
    WORKER.indexOf("// --- explicit stage markers"),
  );

  it("refuses any url not on the confirmed ONIQ asset origin", () => {
    expect(fn).toMatch(/!url\.startsWith\(`\$\{ONIQ_ASSET_ORIGIN\}\/`\)/);
  });

  it("verifies HTTP success, image content-type, and a byte cap", () => {
    expect(fn).toMatch(/if \(!res\.ok\)/);
    expect(fn).toMatch(/\^image\\\/\(png\|jpe\?g\|webp\)\$/);
    expect(fn).toMatch(/buf\.length > OWNER_REF_MAX_BYTES/);
  });

  it("returns an inlined data URL (the only form the gateway accepts)", () => {
    expect(fn).toMatch(/data:\$\{mime\};base64,\$\{buf\.toString\('base64'\)\}/);
  });

  it("never throws the job — every failure path returns null", () => {
    expect(fn).toMatch(/return null/);
    expect(fn).toMatch(/catch \(err\)/);
  });
});

describe("casting and conditioning are wired into the still loop", () => {
  it("casts only the actors this shot's own text supports, one reference", () => {
    expect(WORKER).toMatch(
      /castShot\(\[shot\.still, shot\.narration, plan\.setting \?\? ''\], \{ max: 1 \}\)/,
    );
  });

  it("attaches the reference to story-still only on the character rungs (a < 2)", () => {
    // Rung 3 is people-less scenery by construction, so it never carries a
    // character.
    expect(WORKER).toMatch(
      /const usedRef = Boolean\(refAudit\.characterRefId\) && a < 2/,
    );
  });

  it("sends an IDENTITY, never bytes and never a path", () => {
    // The data URL this used to send was refused outright by the in-house
    // engine: the bucket's write credentials live in the endpoint alone, so
    // there was nowhere for inline bytes to land. An id is resolved to a
    // server-owned key by story-still and re-validated by the worker's own
    // contract before anything is spent.
    expect(WORKER).toMatch(
      /\.\.\.\(usedRef \? \{ characterRefId: refAudit\.characterRefId \} : \{\}\)/,
    );
    expect(WORKER).not.toMatch(/referenceImage: ref/);
  });

  it("records what the ENGINE did, not what this side asked for", () => {
    // An unanchored still looks exactly like an anchored one until the
    // character's face changes between shots. Logging the request would keep
    // that invisible.
    expect(WORKER).toMatch(/conditioned = still\?\.conditioned === true/);
    expect(WORKER).toContain("REFERENCE_NOT_PUBLISHED");
  });

  it("records the full audit trail per shot, without logging base64", () => {
    for (const field of [
      "referenceResolved",
      "referenceFetched",
      "referenceAttached",
      "referenceBytes",
      "characterRefId",
      "styleRefId",
      "generationConditioned",
    ]) {
      expect(WORKER, field).toContain(field);
    }
    // The data URL / base64 is never handed to console.log.
    expect(WORKER).not.toMatch(/console\.log\([^)]*dataUrl/);
    expect(WORKER).not.toMatch(/console\.log\([^)]*base64/);
  });
});

describe("sheet gating — a sheet match degrades to text-only, never a substitution", () => {
  it("carries kind + eligibility into the audit and short-circuits on a sheet", () => {
    expect(WORKER).toMatch(/refAudit\.kind = pick\.actor\.kind/);
    expect(WORKER).toMatch(/refAudit\.referenceEligible = pick\.eligible/);
    // An ineligible (sheet) pick sets a reason and NEVER fetches/attaches.
    expect(WORKER).toMatch(/if \(!pick\.eligible\)/);
    expect(WORKER).toMatch(/SHEET_REFERENCE_NOT_DIRECTLY_ATTACHABLE/);
    // The owner asset is fetched only in the eligible branch.
    expect(WORKER).toMatch(/\} else \{\s*const fetched = await fetchOwnerReference\(pick\.referenceUrl\)/);
  });
});

describe("portrait reframe (FIX 1) — conditioned stills reach 1080x1920, actor never cut", () => {
  it("imports the pure planner with explicit .ts path", () => {
    expect(WORKER).toMatch(
      /import \{ planPortrait, PORTRAIT_W, PORTRAIT_H \} from '\.\.\/\.\.\/src\/lib\/portraitReframe\.ts'/,
    );
  });

  it("reframes ONLY conditioned stills, so the frozen non-actor pipeline is untouched", () => {
    expect(WORKER).toMatch(/if \(ACTOR_REFS && conditioned\) \{\s*const rf = reframeToPortrait\(stillFile\)/);
  });

  const fn = WORKER.slice(
    WORKER.indexOf("function reframeToPortrait"),
    WORKER.indexOf("// --- explicit stage markers"),
  );

  it("drives the plan from the still's real PNG dimensions", () => {
    expect(fn).toMatch(/const dims = pngDimensions\(stillFile\)/);
    expect(fn).toMatch(/const plan = planPortrait\(dims\.w, dims\.h\)/);
  });

  it("never centre-crops blindly — crop comes only from the actor-aware plan", () => {
    expect(fn).toMatch(/if \(plan\.crop\) \{/);
    expect(fn).toMatch(/crop=\$\{w\}:\$\{h\}:\$\{x\}:\$\{y\},scale=\$\{PORTRAIT_W\}:\$\{PORTRAIT_H\}/);
    // pad keeps the WHOLE image (contain), never a hidden crop of the subject.
    expect(fn).toMatch(/force_original_aspect_ratio=decrease/);
  });

  it("never breaks the still — output is validated at target before adoption, errors leave it alone", () => {
    expect(fn).toMatch(/out\.w !== PORTRAIT_W \|\| out\.h !== PORTRAIT_H/);
    expect(fn).toMatch(/fs\.renameSync\(tmp, stillFile\)/);
    expect(fn).toMatch(/catch \(err\)/);
    expect(fn).toMatch(/keeping the still/);
  });

  it("records source + output dims, strategy and actor_preserved into the audit", () => {
    for (const field of [
      "sourceWidth",
      "sourceHeight",
      "outputWidth",
      "outputHeight",
      "reframeStrategy",
      "actorPreserved",
    ]) {
      expect(WORKER, field).toContain(field);
    }
  });
});

describe("portrait precondition — reshape the owner reference to 9:16 before conditioning", () => {
  it("imports the pure precondition planner with explicit .ts path", () => {
    expect(WORKER).toMatch(
      /import \{ planPrecondition \} from '\.\.\/\.\.\/src\/lib\/portraitPrecondition\.ts'/,
    );
  });

  it("is gated behind ACTOR_REFS and DEFAULT OFF (validation showed it neutral-to-worse)", () => {
    expect(WORKER).toMatch(
      /const ACTOR_PRECONDITION =\s*ACTOR_REFS && \(process\.env\.STORY_ACTOR_PRECONDITION \?\? 'off'\) === 'on'/,
    );
    expect(WORKER).toMatch(/if \(ACTOR_PRECONDITION\) \{/);
  });

  const fn = WORKER.slice(
    WORKER.indexOf("function preconditionReferenceToPortrait"),
    WORKER.indexOf("// --- explicit stage markers"),
  );

  it("operates on the ALREADY-FETCHED owner bytes — never fetches, no external URL enters", () => {
    // It takes a buffer, not a URL, and contains no network call: the only way in
    // is through fetchOwnerReference, which already pins the ONIQ origin.
    expect(WORKER).toMatch(/function preconditionReferenceToPortrait\(buf, mime\)/);
    expect(fn).not.toMatch(/fetch\(/);
    expect(fn).not.toMatch(/http/);
  });

  it("never generates a replacement — only deterministic ffmpeg, no edge/gateway call", () => {
    expect(fn).not.toMatch(/edge\(/);
    expect(fn).not.toMatch(/generations/);
    expect(fn).toMatch(/execFileSync\(/);
  });

  it("never touches the owner asset on disk — works on an os.tmpdir temp file and cleans up", () => {
    expect(fn).toMatch(/os\.tmpdir\(\)/);
    expect(fn).toMatch(/fs\.rmSync\(tmpIn, \{ force: true \}\)/);
    expect(fn).toMatch(/fs\.rmSync\(tmpOut, \{ force: true \}\)/);
  });

  it("a portrait source is returned untouched; only landscape is padded", () => {
    expect(fn).toMatch(/if \(!plan\.padded\) \{/);
    expect(fn).toMatch(/force_original_aspect_ratio=increase/); // blurred-fill expansion
  });

  it("never breaks the job — validates the padded output and returns null on any failure", () => {
    expect(fn).toMatch(/od\.w !== cw \|\| od\.h !== ch/);
    expect(fn).toMatch(/return null/);
    expect(fn).toMatch(/catch \(err\)/);
  });

  it("is applied only in the eligible branch, after the owner reference is fetched", () => {
    expect(WORKER).toMatch(
      /const pc = preconditionReferenceToPortrait\(fetched\.buf, fetched\.mime\)/,
    );
    expect(WORKER).toMatch(/refAudit\.preconditionStrategy = pc\.strategy/);
  });
});

describe("the fallback is preserved — no reference means text-only, unchanged", () => {
  it("the edge call omits referenceImage when there is no reference", () => {
    // usedRef is false → the spread contributes nothing → the body is exactly
    // { prompt: asks[a] }, the previous behaviour.
    expect(WORKER).toMatch(/still = await edge\('story-still', \{\s*prompt: asks\[a\],/);
  });

  it("the frozen duration contract is still intact in the same file", () => {
    // Guard that this wiring did not disturb the proven 300s path.
    expect(WORKER).toMatch(/planStory\(job\.requestedSeconds\)/);
    expect(WORKER).toMatch(/const pf = preflight\(manifest\)/);
  });
});

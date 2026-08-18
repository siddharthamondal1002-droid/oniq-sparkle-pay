#!/usr/bin/env node
/**
 * Regenerate supabase/functions/_shared/storyCast.ts from the app-side
 * catalogues.
 *
 * The cast lives in src/data/ in the shape the app wants: a manifest of 74
 * characters keyed by an external tool's asset id, and a separate list of the
 * uploaded house-style frames, each imported as a `.asset.json` pointer. The
 * generator side is Deno — it can resolve neither the `@/` alias nor a JSON
 * import — so it gets a flat mirror instead, and this writes it.
 *
 * Run after ANY change to storyCharacterRefs.ts or storyStyleRefs.ts:
 *
 *     node scripts/gen-story-cast.mjs && npx prettier --write supabase/functions/_shared/storyCast.ts
 *
 * src/data/__tests__/storyCastMemory.test.ts fails until you do.
 */
import fs from "node:fs";

const chars = fs.readFileSync("src/data/storyCharacterRefs.ts", "utf8");
const styles = fs.readFileSync("src/data/storyStyleRefs.ts", "utf8");

// Frame id -> { kind, pointer variable }, and that variable -> its file, so a
// frame's URL is read from the same pointer the app renders.
const frames = {};
const entryRe =
  /id:\s*"([^"]+)",\s*kind:\s*"([^"]+)",\s*title:\s*"([^"]+)",\s*note:\s*"((?:[^"\\]|\\.)*)",\s*url:\s*(\w+)/g;
for (let m; (m = entryRe.exec(styles)); ) frames[m[1]] = { kind: m[2], varName: m[5] };
const varToFile = {};
const impRe = /import\s+(\w+)\s+from\s+"@\/assets\/story-style\/([^"]+)"/g;
for (let m; (m = impRe.exec(styles)); ) varToFile[m[1]] = m[2];

const cast = [];
const castRe =
  /externalAssetId:\s*"([^"]+)",\s*region:\s*"([^"]+)",\s*description:\s*"([^"]+)"(?:,\s*styleRefId:\s*"([^"]+)")?\s*\}/g;
for (let m; (m = castRe.exec(chars)); ) {
  const [, , region, description, styleRefId] = m;
  const row = { region, description };
  if (styleRefId) {
    const frame = frames[styleRefId];
    if (!frame) throw new Error(`${region}: styleRefId "${styleRefId}" resolves to nothing`);
    const pointer = JSON.parse(
      fs.readFileSync(`src/assets/story-style/${varToFile[frame.varName]}`, "utf8"),
    );
    row.frame = pointer.url;
    row.attachable = frame.kind === "scene";
  }
  cast.push(row);
}

if (cast.length === 0) throw new Error("parsed no characters — the manifest shape changed");

const rows = cast
  .map((c) => {
    const parts = [
      `region: ${JSON.stringify(c.region)}`,
      `description: ${JSON.stringify(c.description)}`,
    ];
    if (c.frame) parts.push(`frame: ${JSON.stringify(c.frame)}`, `attachable: ${c.attachable}`);
    return `  { ${parts.join(", ")} },`;
  })
  .join("\n");

const src = fs.readFileSync("scripts/story-cast.template.ts.tmpl", "utf8");
fs.writeFileSync("supabase/functions/_shared/storyCast.ts", src.replace("/*__ROWS__*/", rows));

const withFrames = cast.filter((c) => c.frame).length;
console.log(`storyCast.ts: ${cast.length} characters, ${withFrames} with an in-repo frame`);

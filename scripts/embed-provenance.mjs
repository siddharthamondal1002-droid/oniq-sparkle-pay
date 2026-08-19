#!/usr/bin/env node
/**
 * Stamp an episode MP4 with its AI provenance metadata.
 *
 * STREAM COPY, NEVER RE-ENCODE. A re-encode of a finished six-minute film to
 * add three text tags would cost twenty minutes and a generation of quality
 * for nothing. `-c copy` rewrites the container and leaves every frame byte
 * identical.
 *
 * THE FLAG THAT MATTERS IS `-movflags use_metadata_tags`. Without it ffmpeg
 * writes only the handful of tags it recognises as standard MP4 keys and drops
 * ai_generated / digital_source_type ON THE FLOOR, SILENTLY, exit code 0. That
 * is exactly how a provenance step gets written, reviewed, merged and believed
 * while emitting nothing — so verify-provenance.mjs re-reads the output rather
 * than trusting this script's exit code.
 *
 *   node scripts/embed-provenance.mjs ep4 in.mp4 out.mp4
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const [, , epId, input, output] = process.argv;
if (!epId || !input || !output) {
  console.error("usage: embed-provenance.mjs <ep1|ep2|ep3|ep4> <input.mp4> <output.mp4>");
  process.exit(2);
}
if (!existsSync(input)) {
  console.error(`input not found: ${input}`);
  process.exit(1);
}

// The tag set is defined once, in TypeScript, next to the app that renders the
// matching visible label. Parsed rather than imported so this stays a plain
// node script with no build step in front of it.
const src = readFileSync(new URL("../src/config/aiProvenance.ts", import.meta.url), "utf8");
const block = src.slice(src.indexOf("export const EPISODE_PROVENANCE"));
const entry = block.slice(block.indexOf(`id: "${epId}"`));
const field = (name) => {
  const m = entry.match(new RegExp(`${name}:\\s*"([^"]*)"`));
  return m ? m[1] : "";
};
const p = {
  title: field("title"),
  imageModel: field("imageModel"),
  videoModel: field("videoModel"),
  voice: field("voice"),
  assembly: field("assembly"),
  produced: field("produced"),
};
if (!p.title) {
  console.error(`no provenance entry for "${epId}" in src/config/aiProvenance.ts`);
  process.exit(1);
}
const DIGITAL_SOURCE_TYPE_AI =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

const tags = {
  title: `ONIQ Originals — ${p.title}`,
  comment: `AI-generated. Made by ONIQ with generative AI. Stills: ${p.imageModel}. Motion: ${p.videoModel}. Voice: ${p.voice}. Assembly: ${p.assembly}.`,
  artist: "ONIQ Originals",
  copyright: `© ONIQ ${new Date(p.produced).getUTCFullYear()}`,
  date: p.produced,
  genre: "AI-generated",
  digital_source_type: DIGITAL_SOURCE_TYPE_AI,
  ai_generated: "true",
  ai_generator: `${p.imageModel} + ${p.videoModel}`,
};

const args = ["-y", "-i", input, "-map", "0", "-c", "copy", "-movflags", "use_metadata_tags+faststart"];
for (const [k, v] of Object.entries(tags)) args.push("-metadata", `${k}=${v}`);
args.push(output);

const ff = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
ff.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  console.log(`stamped ${epId} -> ${output}`);
  console.log("now run: node scripts/verify-provenance.mjs " + output);
});

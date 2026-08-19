#!/usr/bin/env node
/**
 * Refuse to believe a file carries provenance until ffprobe says so.
 *
 * This exists because the failure it catches is invisible: embed-provenance
 * exits 0 whether or not ffmpeg kept the custom tags, and the published
 * Episode 2 sat on the CDN for eleven days carrying nothing but
 * "Made with Remotion" while everyone assumed the chain handled it.
 *
 * Takes a local path OR a URL — the URL form is the one that matters, because
 * the only file whose metadata counts is the one being served to phones, not
 * the one that came out of the renderer.
 *
 *   node scripts/verify-provenance.mjs dist/ep4.mp4
 *   node scripts/verify-provenance.mjs https://oniqhub.com/__l5e/.../ep4.mp4
 */
import { spawn } from "node:child_process";

const target = process.argv[2];
if (!target) {
  console.error("usage: verify-provenance.mjs <file.mp4|url>");
  process.exit(2);
}

const REQUIRED = ["comment", "digital_source_type", "ai_generated"];

const probe = spawn("ffprobe", [
  "-v", "error",
  "-show_entries", "format_tags",
  "-of", "json",
  target,
]);
let out = "";
probe.stdout.on("data", (d) => (out += d));
probe.on("exit", (code) => {
  if (code !== 0) {
    console.error(`ffprobe failed on ${target}`);
    process.exit(1);
  }
  const tags = JSON.parse(out || "{}")?.format?.tags ?? {};
  // Tag keys come back with inconsistent case depending on how they were
  // written, so match case-insensitively rather than failing on a capital.
  const lower = Object.fromEntries(Object.entries(tags).map(([k, v]) => [k.toLowerCase(), v]));
  const missing = REQUIRED.filter((k) => !lower[k]);

  for (const k of REQUIRED) {
    const v = lower[k];
    console.log(`${k}: ${v ? String(v).slice(0, 120) : "MISSING"}`);
  }

  if (missing.length) {
    console.error(`\nFAIL — ${target} is missing: ${missing.join(", ")}`);
    console.error("Run scripts/embed-provenance.mjs before publishing this file.");
    process.exit(1);
  }
  if (!String(lower["ai_generated"]).match(/^true$/i)) {
    console.error("\nFAIL — ai_generated is present but not 'true'");
    process.exit(1);
  }
  console.log(`\nPASS — ${target} carries AI provenance`);
});

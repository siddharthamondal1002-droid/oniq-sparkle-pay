// Find where the VOICE actually is in each scene's narration, as frame spans.
//
//   cd remotion && EPISODE=ep3 node scripts/measure-speech.mjs > src/ep3/speech.ts
//
// WHY THIS EXISTS, AND WHY pauses.ts IS NOT ENOUGH. `measure-ep3-pauses.mjs`
// emits pause CENTRES, because a cut wants to land in the middle of a silence.
// A mouth wants the opposite information and it wants it as SPANS.
//
// Deriving spans from centres does not work, and this is measured rather than
// argued: a centre is a point with no width, so the runs between consecutive
// centres tile the scene end to end. Feeding those to `buildMouthCues` produced
// a mouth that rested for 0% of all sixteen ep3 scenes — moving continuously
// for seven minutes, through every pause, with single shapes stretched as long
// as 18 frames to fill the silence. The shapes were right. The silence was
// simply not represented.
//
// So the same envelope is walked here and the SPEECH runs are emitted directly:
// the complement of the silences, not the gaps between their midpoints.
//
// RE-RUN THIS AFTER ANY CHANGE TO THE NARRATION, exactly like the pause table.
// A stale speech table moves the mouth where there is no longer a voice.
//
// Detection matches measure-ep3-pauses.mjs deliberately — a 20ms RMS envelope
// and a -40 dBFS floor — so the two tables describe the same audio. What
// differs is only the minimum run: a 120ms floor here rather than 220ms,
// because a stop short enough to ignore when placing a CUT is still long
// enough to close a mouth, and a mouth that closes between clauses is most of
// what makes it look like speech.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findBin } from './findFfmpeg.mjs';
import { EPISODE, PUBLIC_DIR, sceneIds } from './episode.mjs';

const SR = 16000;
const FPS = 30;
const WINDOW = 0.02;
const FLOOR_DB = -40;
/** Shortest silence that closes the mouth. */
const MIN_SILENCE = 0.12;
/** Shortest run of voice worth opening the mouth for. */
const MIN_SPEECH = 0.08;

/** 20ms RMS envelope of one mp3, in dBFS. */
function envelope(ffmpeg, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'speech-'));
  const wav = path.join(dir, 'a.wav');
  try {
    execFileSync(ffmpeg, [
      '-nostdin', '-v', 'error', '-i', file,
      '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', '-f', 'wav', '-y', wav,
    ]);
    const b = fs.readFileSync(wav);
    // A real chunk walk, not a fixed 44-byte skip: ffmpeg writes a LIST/INFO
    // chunk before `data` often enough that assuming 44 measures metadata as
    // audio.
    let off = -1;
    let len = 0;
    for (let i = 12; i + 8 <= b.length; ) {
      const id = b.toString('ascii', i, i + 4);
      const size = b.readUInt32LE(i + 4);
      if (id === 'data') {
        off = i + 8;
        len = Math.min(size, b.length - off);
        break;
      }
      i += 8 + size + (size % 2);
    }
    if (off < 0) throw new Error(`${file}: no data chunk in the decoded wav`);

    const step = Math.round(SR * WINDOW);
    const out = [];
    for (let s = 0; (s + step) * 2 <= len; s += step) {
      let sum = 0;
      for (let k = 0; k < step; k++) {
        const v = b.readInt16LE(off + (s + k) * 2) / 32768;
        sum += v * v;
      }
      out.push(20 * Math.log10(Math.sqrt(sum / step) + 1e-12));
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Speech spans as [startFrame, endFrame), endFrame exclusive.
 *
 * Two passes. First mark every window as voice or silence. Then drop silences
 * shorter than MIN_SILENCE back into the surrounding speech — the stop before
 * a plosive is not a pause and closing the mouth for it produces a stutter —
 * and finally drop speech runs shorter than MIN_SPEECH, which are clicks and
 * breaths rather than words.
 */
function speechSpans(env) {
  const minSilenceWindows = Math.round(MIN_SILENCE / WINDOW);
  const minSpeechWindows = Math.round(MIN_SPEECH / WINDOW);

  const voiced = env.map((db) => db >= FLOOR_DB);

  // Fill in silences too short to count.
  let runStart = -1;
  for (let i = 0; i <= voiced.length; i++) {
    const silent = i < voiced.length && !voiced[i];
    if (silent && runStart < 0) runStart = i;
    if (!silent && runStart >= 0) {
      if (i - runStart < minSilenceWindows) {
        for (let k = runStart; k < i; k++) voiced[k] = true;
      }
      runStart = -1;
    }
  }

  const spans = [];
  runStart = -1;
  for (let i = 0; i <= voiced.length; i++) {
    const on = i < voiced.length && voiced[i];
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      if (i - runStart >= minSpeechWindows) {
        const a = Math.round(runStart * WINDOW * FPS);
        const b = Math.round(i * WINDOW * FPS);
        if (b > a) spans.push([a, b]);
      }
      runStart = -1;
    }
  }

  // Rounding to frames can make two spans touch or overlap. Merge them rather
  // than emit something buildMouthCues will reject as overlapping.
  const merged = [];
  for (const [a, b] of spans) {
    const prev = merged[merged.length - 1];
    if (prev && a <= prev[1]) {
      prev[1] = Math.max(prev[1], b);
      continue;
    }
    merged.push([a, b]);
  }
  return merged;
}

const ffmpeg = findBin('ffmpeg');
const scenes = sceneIds();
const missing = scenes.filter((id) => !fs.existsSync(path.join(PUBLIC_DIR, `${id}.mp3`)));
if (missing.length > 0) throw new Error(`missing narration: ${missing.join(', ')}`);

const rows = scenes.map((id) => ({
  id,
  spans: speechSpans(envelope(ffmpeg, path.join(PUBLIC_DIR, `${id}.mp3`))),
}));

console.log(`// GENERATED by scripts/measure-speech.mjs — do not hand-edit.`);
console.log(`//`);
console.log(`// Spans of actual VOICE in each scene, as [startFrame, endFrame) at ${FPS}fps`);
console.log(`// from the scene's own start. A span is audio at or above ${FLOOR_DB} dBFS on a`);
console.log(`// ${WINDOW * 1000}ms RMS envelope, with silences under ${MIN_SILENCE * 1000}ms filled in and`);
console.log(`// runs under ${MIN_SPEECH * 1000}ms discarded.`);
console.log(`//`);
console.log(`// This drives the mouth. Re-run after ANY change to the narration mp3s.`);
console.log(``);
console.log(`export const ${EPISODE.toUpperCase()}_SPEECH: Record<string, [number, number][]> = {`);
for (const r of rows) {
  console.log(`  ${r.id}: [${r.spans.map(([a, b]) => `[${a}, ${b}]`).join(', ')}],`);
}
console.log(`};`);
console.log(``);
const totalSpans = rows.reduce((a, r) => a + r.spans.length, 0);
console.log(`// ${totalSpans} speech spans across ${rows.length} scenes.`);
for (const r of rows) {
  if (r.spans.length === 0) console.log(`// WARNING: ${r.id} has no detectable speech.`);
}

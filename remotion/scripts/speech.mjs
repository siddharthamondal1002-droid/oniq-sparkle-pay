// Where the VOICE is in an audio file, as frame spans. Shared, deliberately.
//
// Two callers need this and they must not disagree: scripts/measure-speech.mjs
// bakes an episode's spans into committed data, and scripts/story-worker.mjs
// measures a freshly generated narration at render time. Two copies of a
// silence detector drift, and the drift shows as a mouth that is right in the
// episodes and wrong in Stories.
//
// A pause table is NOT a substitute for this. measure-ep3-pauses.mjs emits
// pause CENTRES, which are points with no width, so the runs between them tile
// a scene end to end — measured at 0% rest across all sixteen ep3 scenes, a
// character talking continuously for seven minutes through every pause.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

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


export { envelope, speechSpans, SR, FPS, WINDOW, FLOOR_DB, MIN_SILENCE, MIN_SPEECH };

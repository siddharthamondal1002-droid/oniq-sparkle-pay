// Measure the narration and precompute the music bed's gain curve.
//
// Writes remotion/src/ep2/bedGain.json — one gain per frame for the whole
// episode. Episode2.tsx reads that array and does no analysis at render time,
// so the mix is inspectable as data instead of as a side effect, and a render
// cannot quietly produce a different balance than the one that was checked.
//
// Run after ANY change to the narration mp3s or the manifest:
//   cd remotion && node scripts/build-bed-envelope.mjs
//
// THE LOGIC IS NOT HERE. Attack, release, threshold, the overlap rule and the
// timeline arithmetic all live in src/lib/audioDuck.ts, where the main vitest
// suite tests them. This script transpiles that file and calls it rather than
// keeping a second copy — two implementations of a mixing curve would drift,
// and the drift would only be audible in a finished render.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const PUBLIC = path.resolve(__dirname, '../public/ep2');
const OUT = path.resolve(__dirname, '../src/ep2/bedGain.json');

/** Load src/lib/audioDuck.ts by transpiling it — no build step, no duplicate. */
async function loadAudioDuck() {
  const src = fs.readFileSync(path.join(REPO, 'src/lib/audioDuck.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'duck-')), 'audioDuck.mjs');
  fs.writeFileSync(tmp, js);
  return import(tmp);
}

/**
 * ffmpeg, but only the one this box actually has.
 *
 * The Remotion compositor ships a cut-down ffmpeg: it DECODES mp3 fine but has
 * no s16le muxer, so the obvious `-f s16le -` pipe silently yields nothing.
 * wav is present, so decode to wav and skip its 44-byte header.
 */
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const candidates = [
    path.join(REPO, 'remotion/node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg'),
    ...fs
      .readdirSync('/tmp', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/tmp/${d.name}/node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg`),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('no ffmpeg found; set FFMPEG=/path/to/ffmpeg');
  return found;
}

const SAMPLE_RATE = 8000; // plenty for a loudness envelope

/** Per-frame RMS of one narration file, normalised to 0..1. */
function speechLevels(ffmpeg, mp3, fps, frames) {
  const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nar-')), 'a.wav');
  execFileSync(ffmpeg, ['-v', 'error', '-i', mp3, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'wav', wav]);
  const buf = fs.readFileSync(wav);
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
  fs.rmSync(path.dirname(wav), { recursive: true, force: true });

  const perFrame = SAMPLE_RATE / fps;
  const out = new Array(frames).fill(0);
  for (let f = 0; f < frames; f++) {
    const from = Math.floor(f * perFrame);
    const to = Math.min(pcm.length, Math.floor((f + 1) * perFrame));
    let sum = 0;
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
    const rms = to > from ? Math.sqrt(sum / (to - from)) : 0;
    out[f] = Math.min(1, rms / 32768);
  }
  return out;
}

const { EP2_FRAMES, EP2_SCENES, EP2_TOTAL, FPS, TRANSITION_FRAMES } = await import(
  '../src/ep2/manifest.ts'
).catch(async () => {
  // manifest.ts is TypeScript; transpile it the same way.
  const src = fs.readFileSync(path.resolve(__dirname, '../src/ep2/manifest.ts'), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'man-')), 'manifest.mjs');
  fs.writeFileSync(tmp, js);
  return import(tmp);
});

const {
  BED_ALONE_DB,
  BED_UNDER_SPEECH_DB,
  DEFAULT_DUCK,
  PEAK_HOLD_FRAMES,
  applyEdgeFades,
  gainsForTargets,
  layOnTimeline,
  normaliseByPercentile,
  peakHold,
  sceneStartFrames,
  speechToGain,
} = await loadAudioDuck();
const ffmpeg = findFfmpeg();

/** Overall RMS of a file, 0..1, via the same decode path as the envelope. */
function fileRms(ff, file) {
  const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rms-')), 'a.wav');
  execFileSync(ff, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'wav', wav]);
  const buf = fs.readFileSync(wav);
  const pcm = new Int16Array(buf.buffer, buf.byteOffset + 44, (buf.length - 44) >> 1);
  fs.rmSync(path.dirname(wav), { recursive: true, force: true });
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length) / 32768;
}

const perScene = EP2_SCENES.map((scene, i) => {
  const mp3 = path.join(PUBLIC, `${scene.id}.mp3`);
  if (!fs.existsSync(mp3)) throw new Error(`missing narration: ${mp3}`);
  return speechLevels(ffmpeg, mp3, FPS, EP2_FRAMES[i]);
});

// ORDER MATTERS. Peak-hold per scene, before the scenes are laid down, so the
// smoothing window never reaches across a scene boundary and smears one
// narration into its neighbour's silence. Normalise across the WHOLE episode,
// after laying down, so every scene is judged on one consistent scale rather
// than each being stretched to its own loudest moment.
const starts = sceneStartFrames(EP2_FRAMES, TRANSITION_FRAMES);
const held = perScene.map((level) => peakHold(level, PEAK_HOLD_FRAMES));
const speech = normaliseByPercentile(layOnTimeline(held, starts, EP2_TOTAL));

// Calibrate against what the two files ACTUALLY measure, rather than trusting
// a hand-tuned gain. Episode 2's bed came back 10 dB louder than the narration
// it sits under; a fixed 0.14 would have put music 6 dB under the voice
// instead of 16.
const bedFile = path.join(PUBLIC, 'bed.mp3');
if (!fs.existsSync(bedFile)) throw new Error(`missing music bed: ${bedFile}`);
const bedRms = fileRms(ffmpeg, bedFile);
const speechRms = fileRms(ffmpeg, path.join(PUBLIC, `${EP2_SCENES[0].id}.mp3`));
const levels = gainsForTargets(bedRms, speechRms);

const gain = applyEdgeFades(speechToGain(speech, levels), 2 * FPS, 3 * FPS);

const db = (v) => (20 * Math.log10(v || 1e-9)).toFixed(1);

fs.writeFileSync(
  OUT,
  `${JSON.stringify({
    fps: FPS,
    frames: EP2_TOTAL,
    // The calibration this curve was built from, so a reader (and the test)
    // can see what the numbers mean instead of inferring them.
    measured: { bedDb: Number(db(bedRms)), narrationDb: Number(db(speechRms)) },
    levels: { under: Number(levels.under.toFixed(4)), alone: Number(levels.alone.toFixed(4)) },
    gain: gain.map((g) => Number(g.toFixed(4))),
  })}\n`,
);

const speaking = speech.filter((s) => s >= DEFAULT_DUCK.threshold).length;
console.log(`ep2 bed envelope -> ${OUT}`);
console.log(`  ${EP2_TOTAL} frames (${(EP2_TOTAL / FPS).toFixed(1)}s)`);
console.log(`  narration detected in ${((100 * speaking) / EP2_TOTAL).toFixed(1)}% of frames`);
console.log(`  measured: bed ${db(bedRms)} dB, narration ${db(speechRms)} dB`);
console.log(
  `  gains: under ${levels.under.toFixed(3)} (${BED_UNDER_SPEECH_DB} dB vs voice), ` +
    `alone ${levels.alone.toFixed(3)} (${BED_ALONE_DB} dB)`,
);
console.log(`  resulting bed under speech: ${db(bedRms * levels.under)} dB`);
console.log(`  gain min ${Math.min(...gain).toFixed(3)} max ${Math.max(...gain).toFixed(3)}`);

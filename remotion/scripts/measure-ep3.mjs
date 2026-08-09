// Measure Episode 3's narration and print the manifest array.
//
//   cd remotion && node scripts/measure-ep3.mjs
//
// Paste the output over EP3_SCENES in src/ep3/manifest.ts and set
// MEASURED = true. Nothing here writes to the manifest: the numbers are the one
// thing in this pipeline that must be reviewed by a person, because everything
// downstream — the shot split, the scene offsets, a bed envelope if one is ever
// added — is derived from them and inherits any mistake silently.
//
// WHY THIS EXISTS AT ALL. Episode timelines are built from ffprobe measurements
// and never from the word-count estimate in originalsScript.ts. An estimate is
// wrong by a second or two per scene, always in an unpredictable direction, and
// the error accumulates: by scene sixteen the picture is several seconds off
// the voice. That is not subtle, and it is not fixable after the render.
//
// Reports BOTH the container duration and the decoded length, and writes the
// container one into the manifest — which is what ep1 and ep2 already use, so
// the three episodes stay measured the same way.
//
// They differ, slightly, and it is worth knowing why rather than being
// surprised by it later: an mp3 carries encoder padding, so ffprobe's container
// duration runs ~50ms longer than the audio you can actually hear. Across
// sixteen scenes that is 0.8s, about a frame and a half per scene. Immaterial
// here, but if the two ever diverge by more than a few hundred milliseconds on
// one file, that file is damaged and should be regenerated rather than shipped.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findBin } from './findFfmpeg.mjs';
import { EPISODE, PUBLIC_DIR, sceneIds, transitionSeconds } from './episode.mjs';

const PUBLIC = PUBLIC_DIR;
const SAMPLE_RATE = 8000;
const FPS = 30;

/** Container duration, in seconds. This is what goes in the manifest. */
function containerSeconds(fp, file) {
  const out = execFileSync(fp, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ])
    .toString()
    .trim();
  const seconds = Number(out);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`${file}: ffprobe reported duration "${out}"`);
  }
  return seconds;
}

function decodedSeconds(ff, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'len-'));
  const wav = path.join(dir, 'a.wav');
  execFileSync(ff, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'wav', wav]);
  const bytes = fs.statSync(wav).size - 44;
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes / 2 / SAMPLE_RATE;
}

const ffmpeg = findBin('ffmpeg');
const ffprobe = findBin('ffprobe');
const scenes = sceneIds();

const missing = scenes.filter((id) => !fs.existsSync(path.join(PUBLIC, `${id}.mp3`)));
if (missing.length > 0) {
  throw new Error(`missing narration in ${PUBLIC}: ${missing.join(', ')}`);
}

let total = 0;
/** Per-scene frame counts, rounded the way the manifest rounds them. */
const sceneFrames = [];
const rows = scenes.map((id) => {
  const file = path.join(PUBLIC, `${id}.mp3`);
  const seconds = containerSeconds(ffprobe, file);
  // Second, independent reading. Two measurements that agree are worth more
  // than one that is merely plausible, and a file whose decoded audio is much
  // shorter than its container claims is truncated — which would show up as a
  // scene going silent early and nothing else.
  const decoded = decodedSeconds(ffmpeg, file);
  if (Math.abs(seconds - decoded) > 0.3) {
    throw new Error(
      `${id}.mp3: container says ${seconds.toFixed(3)}s but only ${decoded.toFixed(3)}s decodes. ` +
        `Regenerate it.`,
    );
  }
  total += seconds;
  sceneFrames.push(Math.round(seconds * FPS));
  return `  { id: '${id}', seconds: ${seconds.toFixed(3)} },`;
});

const UP = EPISODE.toUpperCase();
console.log(`export const ${UP}_SCENES: ${UP[0]}${UP.slice(1).toLowerCase()}Scene[] = [`);
console.log(rows.join('\n'));
console.log('];');
console.log();

// TRANSITION is READ FROM THE MANIFEST, not hardcoded. It used to be a literal
// 0.5 here, and when the real value dropped to 0.25 this line silently reported
// an episode 105 frames shorter than the one that renders. A derived number
// that quietly stops being derived is worse than no number at all.
//
// A regex rather than an import because this script is node and the manifest is
// TypeScript — the same constraint build-bed-envelope.mjs works around by
// transpiling. One constant does not justify a transpile.
const TRANSITION_FRAMES = Math.round(transitionSeconds() * FPS);

// Round PER SCENE and then sum, which is what manifest.ts does. Rounding the
// total instead can differ by a frame — the per-scene fractions sum past a
// half-frame that no single scene crosses. One frame is immaterial to the
// picture, and not immaterial to someone comparing this line against EP3_TOTAL
// and finding they disagree.
const totalFrames =
  sceneFrames.reduce((a, b) => a + b, 0) - TRANSITION_FRAMES * (scenes.length - 1);
console.log(
  `// ${total.toFixed(1)}s of narration, ${totalFrames} frames after transitions ` +
    `= ${(totalFrames / FPS / 60).toFixed(2)} min (${(totalFrames / FPS).toFixed(1)}s)`,
);
console.log('// Set MEASURED = true once these are in. Then re-check the shot split:');
console.log(`//   bun -e "await import('./src/${EPISODE}/shots.ts')"`);

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
// Measures by DECODING TO WAV rather than reading a container header. Same
// approach as build-bed-envelope.mjs and for the same reason: the Remotion
// compositor ships a cut-down ffmpeg, wav is one of the few muxers it has, and
// a decoded byte count cannot disagree with what the renderer will actually
// play the way a metadata field can.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const PUBLIC = path.resolve(__dirname, '../public/ep3');
const SAMPLE_RATE = 8000;
const FPS = 30;

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

function decodedSeconds(ff, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'len-'));
  const wav = path.join(dir, 'a.wav');
  execFileSync(ff, ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'wav', wav]);
  const bytes = fs.statSync(wav).size - 44;
  fs.rmSync(dir, { recursive: true, force: true });
  return bytes / 2 / SAMPLE_RATE;
}

const ffmpeg = findFfmpeg();
const scenes = Array.from({ length: 16 }, (_, i) => `ep3_s${String(i + 1).padStart(2, '0')}`);

const missing = scenes.filter((id) => !fs.existsSync(path.join(PUBLIC, `${id}.mp3`)));
if (missing.length > 0) {
  throw new Error(`missing narration in ${PUBLIC}: ${missing.join(', ')}`);
}

let total = 0;
const rows = scenes.map((id) => {
  const seconds = decodedSeconds(ffmpeg, path.join(PUBLIC, `${id}.mp3`));
  total += seconds;
  return `  { id: '${id}', seconds: ${seconds.toFixed(3)} },`;
});

console.log('export const EP3_SCENES: Ep3Scene[] = [');
console.log(rows.join('\n'));
console.log('];');
console.log();

const totalFrames = Math.round(total * FPS) - Math.round(0.5 * FPS) * (scenes.length - 1);
console.log(
  `// ${total.toFixed(1)}s of narration, ${totalFrames} frames after transitions ` +
    `= ${(totalFrames / FPS / 60).toFixed(2)} min`,
);
console.log('// Set MEASURED = true once these are in. Then re-check the shot split:');
console.log('//   bun -e "await import(\'./src/ep3/shots.ts\')"');

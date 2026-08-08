// Conform generated Veo clips into something the composition can actually cut.
//
//   cd remotion
//   bun scripts/ingest-ep3-clips.mjs --from /path/to/raw     # conform
//   bun scripts/ingest-ep3-clips.mjs --check                 # verify only
//
// BUN, not node: it resolves the TypeScript shot plan across directories, which
// is where the per-shot frame counts come from. Node would need a build step.
//
// Reads raw clips as <from>/<shotId>.mp4 and writes public/ep3/clips/<shotId>.mp4.
//
// FOUR THINGS ARE WRONG WITH EVERY CLIP THE GENERATOR RETURNS, and all four are
// invisible until playback. Each is fixed here, in one pass, because four
// separate passes is four chances to skip one:
//
//   1. IT CARRIES ITS OWN AUDIO. Veo invents a soundtrack — wind, crowd, score.
//      Left on, it plays underneath the narration. `-an`.
//   2. IT IS 1088 WIDE, NOT 1080. h264 macroblock rounding. Left alone, every
//      shot sits 8px off. `crop=1080:1920`, centred, which is ffmpeg's default
//      offset and loses 4px a side of frame the generator invented anyway.
//   3. IT IS 24fps AND THE TIMELINE IS 30. Left alone it judders, and judder is
//      easy to excuse as "the animation". `-r 30`.
//   4. IT IS ~10.04s AND THE SHOT IS NOT. `-frames:v` trims to the exact
//      allocation, which is the single trim site per shot.
//
// A NOTE ON `-r 30`. The compositor's cut-down ffmpeg has NO `fps` filter and
// no `setpts` — the obvious `-vf fps=30` fails. `-r` as an OUTPUT option goes
// through the encoder's own frame-duplication path instead and does work; that
// was verified on this box against a synthetic 24fps 1088x1920 clip before this
// script was written, not assumed from documentation.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const OUT_DIR = path.resolve(__dirname, '../public/ep3/clips');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const fromIdx = args.indexOf('--from');
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : process.env.FROM;

const { EP3_SHOT_PLAN } = await import('../src/ep3/shots.ts').catch((err) => {
  throw new Error(
    `could not load the shot plan (${err.message}). Run this with bun, not node — ` +
      `src/ep3/shots.ts imports TypeScript from ../../src.`,
  );
});
const { FPS } = await import('../src/ep3/manifest.ts');

function findBin(name) {
  const env = process.env[name.toUpperCase()];
  if (env) return env;
  const candidates = [
    path.join(REPO, `remotion/node_modules/@remotion/compositor-linux-x64-gnu/${name}`),
    ...fs
      .readdirSync('/tmp', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/tmp/${d.name}/node_modules/@remotion/compositor-linux-x64-gnu/${name}`),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`no ${name} found; set ${name.toUpperCase()}=/path/to/${name}`);
  return found;
}

const ffmpeg = findBin('ffmpeg');
const ffprobe = findBin('ffprobe');

/** width, height, fps, frame count and whether it has audio. Counted, not read. */
function probe(file) {
  const out = execFileSync(ffprobe, [
    '-v', 'error',
    '-count_frames',
    '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_read_frames',
    '-of', 'default=nw=1',
    file,
  ]).toString();
  const streams = out.split('codec_type=').slice(1);
  const video = streams.find((s) => s.startsWith('video')) ?? '';
  const get = (k) => video.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1];
  const [num, den] = (get('r_frame_rate') ?? '0/1').split('/').map(Number);
  return {
    width: Number(get('width')),
    height: Number(get('height')),
    fps: den ? num / den : 0,
    frames: Number(get('nb_read_frames')),
    hasAudio: streams.some((s) => s.startsWith('audio')),
  };
}

/** Everything that is wrong with one conformed clip, in plain words. */
function faults(file, shot) {
  const p = probe(file);
  const out = [];
  if (p.hasAudio) out.push('still has an audio stream');
  if (p.width !== 1080 || p.height !== 1920) out.push(`is ${p.width}x${p.height}, not 1080x1920`);
  if (p.fps !== FPS) out.push(`is ${p.fps}fps, not ${FPS}`);
  if (p.frames !== shot.frames) out.push(`is ${p.frames} frames, not ${shot.frames}`);
  return out;
}

fs.mkdirSync(OUT_DIR, { recursive: true });

if (CHECK_ONLY) {
  let bad = 0;
  for (const shot of EP3_SHOT_PLAN) {
    const file = path.join(OUT_DIR, `${shot.id}.mp4`);
    if (!fs.existsSync(file)) {
      console.log(`MISSING  ${shot.id}  (${(shot.frames / FPS).toFixed(2)}s)`);
      bad++;
      continue;
    }
    const f = faults(file, shot);
    if (f.length > 0) {
      console.log(`BAD      ${shot.id}  ${f.join('; ')}`);
      bad++;
    }
  }
  console.log(`\n${EP3_SHOT_PLAN.length - bad}/${EP3_SHOT_PLAN.length} clips ready`);
  process.exit(bad === 0 ? 0 : 1);
}

if (!FROM) throw new Error('pass --from <dir> with the raw generated clips, or --check');
if (!fs.existsSync(FROM)) throw new Error(`no such directory: ${FROM}`);

let done = 0;
let skipped = 0;
for (const shot of EP3_SHOT_PLAN) {
  const src = path.join(FROM, `${shot.id}.mp4`);
  const dst = path.join(OUT_DIR, `${shot.id}.mp4`);
  if (!fs.existsSync(src)) {
    console.log(`skip  ${shot.id}  (no raw clip at ${src})`);
    skipped++;
    continue;
  }

  const raw = probe(src);
  // A clip shorter than its allocation cannot be padded — there is nothing to
  // pad WITH, and freezing or slowing the tail is visible. Say so and stop
  // rather than producing a short clip that desynchronises everything after it.
  if (Math.round(raw.frames * (FPS / (raw.fps || FPS))) < shot.frames) {
    throw new Error(
      `${shot.id}: raw clip is ${raw.frames} frames at ${raw.fps}fps, short of the ` +
        `${shot.frames} frames this shot needs. Re-generate it longer; do not stretch it.`,
    );
  }

  execFileSync(ffmpeg, [
    '-y', '-v', 'error',
    '-i', src,
    '-an',                       // 1. drop the generated soundtrack
    '-vf', 'crop=1080:1920',     // 2. 1088 -> 1080, centred
    '-r', String(FPS),           // 3. 24 -> 30
    '-frames:v', String(shot.frames), // 4. trim to the allocation
    '-c:v', 'libx264',
    '-preset', 'medium',
    // Near-transparent for an intermediate. The episode is encoded once more at
    // crf 28 on the way out; compressing hard twice compounds the artefacts.
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    dst,
  ]);

  const f = faults(dst, shot);
  if (f.length > 0) throw new Error(`${shot.id} came out wrong: ${f.join('; ')}`);

  done++;
  console.log(`ok    ${shot.id}  ${shot.frames}f (${(shot.frames / FPS).toFixed(2)}s)`);
}

console.log(`\nconformed ${done}, skipped ${skipped}, of ${EP3_SHOT_PLAN.length} shots -> ${OUT_DIR}`);
if (skipped > 0) console.log('run again once the missing clips are generated, then --check');

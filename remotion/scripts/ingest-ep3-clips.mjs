// Conform generated Veo clips into something the composition can actually cut.
//
//   cd remotion
//   bun scripts/ingest-ep3-clips.mjs --from /path/to/raw     # conform (skips
//                                                            # what is already
//                                                            # done; --force to
//                                                            # re-encode)
//   bun scripts/ingest-ep3-clips.mjs --fetch                 # pull conformed clips
//   bun scripts/ingest-ep3-clips.mjs --fetch-raw             # pull the raw
//                                                            # generations, which
//                                                            # is what --from then
//                                                            # reads by default
//   bun scripts/ingest-ep3-clips.mjs --check                 # verify only
//
// WHERE THE CLIPS ACTUALLY LIVE. Not in git — sixty conformed clips is ~250 MB
// and the repo rejects any single file over 10 MB. They live as Lovable CDN
// assets, and what IS committed is one `<shot>.mp4.asset.json` pointer each,
// a few hundred bytes. `--fetch` turns those pointers back into local files so
// the renderer can see them.
//
// This is also what makes a sixty-clip build resumable. The Lovable agent's box
// keeps `/mnt/documents` across messages but nothing else, and it cannot
// `git add -f` a gitignored mp4 — so an uploaded asset plus a committed pointer
// is the only store both machines can rely on. Assets are IMMUTABLE and every
// upload mints a fresh id, so re-conforming a clip means rewriting its pointer,
// never updating an asset in place.
//
// BUN, not node: it resolves the TypeScript shot plan across directories, which
// is where the per-shot frame counts come from. Node would need a build step.
//
// Reads raw clips as <from>/<shotId>.mp4 and writes public/ep3/clips/<shotId>.mp4.
// <from> defaults to public/ep3/raw, where --fetch-raw puts them.
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
/** Where the untrimmed generations live, and what --from reads by default. */
const RAW_DIR = path.resolve(__dirname, '../public/ep3/raw');

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const FORCE = args.includes('--force');
const FETCH = args.includes('--fetch');
/** Pull the untrimmed generations rather than the conformed clips. */
const FETCH_RAW = args.includes('--fetch-raw');
const fromIdx = args.indexOf('--from');
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : (process.env.FROM ?? RAW_DIR);
const baseIdx = args.indexOf('--base');
/** Origin the asset URLs hang off. They are stored site-relative. */
const BASE = (
  baseIdx >= 0 ? args[baseIdx + 1] : (process.env.ASSET_BASE ?? 'https://oniq-sparkle-pay.lovable.app')
).replace(/\/$/, '');

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
if (FETCH_RAW) fs.mkdirSync(RAW_DIR, { recursive: true });

// The same root cause arrives two ways and neither is self-explanatory: this
// repo's dev container proxies outbound traffic and DENIES oniqhub.com and
// *.lovable.app. A denied CONNECT surfaces as a thrown "fetch failed"; a denied
// GET surfaces as a 403 RESPONSE. Both mean "wrong machine", not "bad asset".
const WRONG_BOX =
  `\n  If you are on the ONIQ dev container this is expected — its proxy blocks` +
  `\n  *.lovable.app. Run this on a box with open egress (the ep3-clip-transfer` +
  `\n  workflow does exactly that), or pass --base with a reachable origin.`;

/** The committed CDN pointer for a shot, or null if it has never been uploaded. */
function pointerFor(shot, dir = OUT_DIR) {
  const file = path.join(dir, `${shot.id}.mp4.asset.json`);
  if (!fs.existsSync(file)) return null;
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!p.url) throw new Error(`${shot.id}: pointer has no url — ${file}`);
  return p;
}

if (FETCH_RAW) {
  // Pull the RAW generations — the untrimmed, 1088-wide, 24fps clips with their
  // invented soundtrack still on them, straight as Veo returned them.
  //
  // WHY THEY MATTER. A conformed clip is trimmed to exactly its allocation, so
  // it has no spare frames. Re-cutting the episode — moving a cut onto a pause
  // in the narration — makes the shot on one side of that cut LONGER, and those
  // frames exist only in the raw. Without the raws a re-cut means regenerating;
  // with them it is a re-conform.
  //
  // Deliberately NOT validated with faults(): every one of those checks is a
  // statement about a CONFORMED clip, and a raw legitimately fails all four. It
  // has audio, it is 1088 wide, it is 24fps, and it is longer than the shot.
  // Size against the pointer is the check that applies, and the conform path
  // already refuses a raw too short for its allocation.
  let got = 0;
  let had = 0;
  let none = 0;
  for (const shot of EP3_SHOT_PLAN) {
    const dst = path.join(RAW_DIR, `${shot.id}.mp4`);
    const pointer = pointerFor(shot, RAW_DIR);
    if (!pointer) {
      console.log(`none  ${shot.id}  (no raw pointer)`);
      none++;
      continue;
    }
    if (fs.existsSync(dst) && fs.statSync(dst).size === pointer.size) {
      had++;
      continue;
    }
    const url = `${BASE}${pointer.url}`;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`${shot.id}: could not reach ${url} (${err.message}).${WRONG_BOX}`);
    }
    if (!res.ok) {
      throw new Error(`${shot.id}: ${res.status} fetching ${url}` + (res.status === 403 ? WRONG_BOX : ''));
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (pointer.size && bytes.length !== pointer.size) {
      throw new Error(`${shot.id}: got ${bytes.length} bytes, pointer says ${pointer.size}`);
    }
    fs.writeFileSync(dst, bytes);
    got++;
    console.log(`raw   ${shot.id}  ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
  console.log(
    `\nfetched ${got}, already present ${had}, no pointer ${none}, of ${EP3_SHOT_PLAN.length} -> ${RAW_DIR}`,
  );
  process.exit(none === 0 ? 0 : 1);
}

if (FETCH) {
  // Turn committed pointers back into local files. Idempotent: a clip already
  // on disk and passing every check is left alone, so re-running after a
  // partial download costs only the clips that are actually missing.
  let got = 0;
  let had = 0;
  let none = 0;
  for (const shot of EP3_SHOT_PLAN) {
    const dst = path.join(OUT_DIR, `${shot.id}.mp4`);
    if (fs.existsSync(dst) && faults(dst, shot).length === 0) {
      had++;
      continue;
    }
    const pointer = pointerFor(shot);
    if (!pointer) {
      console.log(`none  ${shot.id}  (not generated yet)`);
      none++;
      continue;
    }

    // The asset URL 302s to R2, which fetch follows by default.
    const url = `${BASE}${pointer.url}`;

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`${shot.id}: could not reach ${url} (${err.message}).${WRONG_BOX}`);
    }
    if (!res.ok) {
      throw new Error(
        `${shot.id}: ${res.status} fetching ${url}` + (res.status === 403 ? WRONG_BOX : ''),
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());

    // Size is in the pointer, so a truncated download is caught here rather
    // than surfacing as a corrupt frame two hours into a render.
    if (pointer.size && bytes.length !== pointer.size) {
      throw new Error(`${shot.id}: got ${bytes.length} bytes, pointer says ${pointer.size}`);
    }
    fs.writeFileSync(dst, bytes);

    const f = faults(dst, shot);
    if (f.length > 0) {
      fs.rmSync(dst);
      throw new Error(`${shot.id} downloaded but is wrong: ${f.join('; ')}`);
    }
    got++;
    console.log(`get   ${shot.id}  ${shot.frames}f  ${(bytes.length / 1e6).toFixed(1)} MB`);
  }
  console.log(`\nfetched ${got}, already present ${had}, not yet generated ${none}, of ${EP3_SHOT_PLAN.length}`);
  process.exit(none === 0 ? 0 : 1);
}

if (CHECK_ONLY) {
  let bad = 0;
  for (const shot of EP3_SHOT_PLAN) {
    const file = path.join(OUT_DIR, `${shot.id}.mp4`);
    if (!fs.existsSync(file)) {
      // Two very different situations, and conflating them wastes a generation:
      // a clip that exists on the CDN and merely needs `--fetch`, versus one
      // that was never made.
      const where = pointerFor(shot) ? 'ON CDN, run --fetch' : 'not generated';
      console.log(`MISSING  ${shot.id}  (${(shot.frames / FPS).toFixed(2)}s) — ${where}`);
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

// --from defaults to RAW_DIR, so "no directory given" can no longer happen.
// What CAN happen, and now says so, is being pointed at a directory that is
// empty or absent — which on this box means --fetch-raw has not been run.
if (!fs.existsSync(FROM)) {
  throw new Error(
    `no raw clips at ${FROM}. Pass --from <dir>, or recover them with:\n` +
      `      bun scripts/ingest-ep3-clips.mjs --fetch-raw`,
  );
}
if (!fs.existsSync(FROM)) throw new Error(`no such directory: ${FROM}`);

let done = 0;
let skipped = 0;
let already = 0;
for (const shot of EP3_SHOT_PLAN) {
  const src = path.join(FROM, `${shot.id}.mp4`);
  const dst = path.join(OUT_DIR, `${shot.id}.mp4`);

  // ALREADY CONFORMED AND PASSING? Leave it alone.
  //
  // Without this the script re-encodes all sixty clips on every run, which is
  // ten to twenty minutes of pointless h264 for the sake of the two or three
  // that are new — long enough to blow a shell timeout, which is exactly what
  // happened while finishing scenes 13-16. Pass --force to re-encode anyway.
  if (!FORCE && fs.existsSync(dst) && faults(dst, shot).length === 0) {
    already++;
    continue;
  }

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

console.log(
  `\nconformed ${done}, already good ${already}, no raw ${skipped}, of ${EP3_SHOT_PLAN.length} -> ${OUT_DIR}`,
);
if (skipped > 0) console.log('run again once the missing clips are generated, then --check');

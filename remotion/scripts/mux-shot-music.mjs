// Put music under the rendered promo shots — WITHOUT re-rendering a frame.
//
//   node scripts/make-promo-music.mjs
//   SHOTS_DIR=... OUT_DIR=... node scripts/mux-shot-music.mjs
//
// The video stream is copied bit-for-bit (-c:v copy); only an AAC track is
// added, trimmed to the shot and faded out over its last second. Re-rendering
// fifty shots to add audio would cost half an hour for something ffmpeg does
// in seconds per file.
//
// Bed assignment mirrors the shots' own moods: the cinematic ones (originals,
// story, worlds) get `drift`; everything else gets `pulse`.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS_DIR = process.env.SHOTS_DIR ?? path.resolve(__dirname, '../../.tmp/promo-shots');
const MUSIC_DIR = process.env.MUSIC_DIR ?? path.resolve(__dirname, '../../.tmp/promo-music');
const OUT_DIR = process.env.OUT_DIR ?? path.resolve(__dirname, '../../.tmp/promo-shots-music');
fs.mkdirSync(OUT_DIR, { recursive: true });

const DRIFT = /originals|story|worlds/;

const files = fs.readdirSync(SHOTS_DIR).filter((f) => f.endsWith('.mp4')).sort();
if (files.length === 0) throw new Error(`no shots in ${SHOTS_DIR}`);

let done = 0;
for (const f of files) {
  const src = path.join(SHOTS_DIR, f);
  const out = path.join(OUT_DIR, f);
  const bed = path.join(MUSIC_DIR, DRIFT.test(f) ? 'drift.wav' : 'pulse.wav');
  const dur = parseFloat(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src,
    ]).toString(),
  );
  const fadeStart = Math.max(0, dur - 1).toFixed(2);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', src,
    '-i', bed,
    '-filter_complex',
    `[1:a]atrim=0:${dur.toFixed(2)},afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeStart}:d=1[a]`,
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-shortest',
    out,
  ]);
  done += 1;
}
console.log(`muxed ${done}/${files.length} into ${OUT_DIR}`);

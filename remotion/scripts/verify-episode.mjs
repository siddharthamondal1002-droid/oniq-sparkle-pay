// Check a rendered episode before anyone uploads it.
//
//   node scripts/verify-episode.mjs /path/to/ep3.mp4 --expect 407.2
//
// Exits non-zero on any failure, so it can gate an upload rather than merely
// inform one.
//
// WHY THIS IS A SCRIPT AND NOT A HABIT. Every check below exists because this
// project already shipped the thing it catches:
//
//   - Episode 1 was first built with all twelve narration mp3s generated and
//     not one of them mounted. A 4:47 silent slideshow. No still frame, and no
//     "does the file have an audio stream" check, would have caught it.
//   - A track present at -91 dBFS has twice passed as sound, because an
//     `ffprobe` that reports `codec_name=aac` reports it just as happily for
//     silence. So this decodes real samples from the MIDDLE of the file and
//     measures them.
//   - A duration that disagrees with the narration means the timeline and the
//     voice have drifted apart, which is the one arithmetic failure every guard
//     in the pipeline exists to prevent, and it is unfixable after the render.
//
// The audio measurement is done here in JS rather than with a filter because
// the compositor's ffmpeg has no `volumedetect` and no `astats`. It does have
// the wav muxer and pcm_s16le, so decoding a few seconds and doing the sums is
// both available and stricter: it reports RMS *and* peak, and a number is
// harder to misread than a filter's log line.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { findBin } from './findFfmpeg.mjs';
import { packetCoverageFailures } from './mediaIntegrity.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const expectIdx = args.indexOf('--expect');
const EXPECT = expectIdx >= 0 ? Number(args[expectIdx + 1]) : null;

/** Seconds of drift from --expect that is a failure rather than a rounding tail. */
const DURATION_TOLERANCE = 1.0;
/** Seconds of audio to decode per probe point. */
const SAMPLE_SECONDS = 4;
/**
 * RMS below this is silence with extra steps. Narration measures around
 * -28 dBFS; a muted or unmounted track measures around -91. There is no honest
 * signal anywhere near the line, which is what makes it a safe one.
 */
const SILENCE_DBFS = -60;

if (!file) {
  console.error('usage: node scripts/verify-episode.mjs <file.mp4> [--expect <seconds>]');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`no such file: ${file}`);
  process.exit(2);
}
if (expectIdx >= 0 && !Number.isFinite(EXPECT)) {
  console.error(`--expect needs a number, got "${args[expectIdx + 1]}"`);
  process.exit(2);
}

const ffmpeg = findBin('ffmpeg');
const ffprobe = findBin('ffprobe');
const failures = [];

/** Every stream in the file, as an array of plain objects. */
function probeStreams() {
  const out = execFileSync(ffprobe, [
    '-v', 'error',
    '-count_packets',
    '-show_entries',
    'stream=index,codec_type,codec_name,width,height,r_frame_rate,bit_rate,sample_rate,channels,nb_read_packets',
    '-of', 'json',
    file,
  ]).toString();
  return JSON.parse(out).streams ?? [];
}

function probeFormat() {
  const out = execFileSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,size,bit_rate',
    '-of', 'json',
    file,
  ]).toString();
  return JSON.parse(out).format ?? {};
}

/**
 * Decode SAMPLE_SECONDS from `at` and return its level.
 *
 * Mono at 16 kHz because this is a loudness question, not a fidelity one, and a
 * smaller wav is a faster read. The header walk is a real chunk walk rather
 * than a fixed 44-byte skip: ffmpeg writes a LIST/INFO chunk before `data` often
 * enough that assuming 44 would silently measure metadata as audio.
 */
function levelAt(at) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lvl-'));
  const wav = path.join(dir, 'a.wav');
  try {
    execFileSync(ffmpeg, [
      '-nostdin', '-v', 'error',
      '-ss', String(at), '-t', String(SAMPLE_SECONDS), '-i', file,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', '-y', wav,
    ]);
    const b = fs.readFileSync(wav);
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
    if (off < 0 || len < 2) return null;

    let sum = 0;
    let peak = 0;
    let n = 0;
    for (let p = off; p + 1 < off + len; p += 2) {
      const s = b.readInt16LE(p) / 32768;
      sum += s * s;
      if (Math.abs(s) > peak) peak = Math.abs(s);
      n += 1;
    }
    if (n === 0) return null;
    const db = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
    return { rms: db(Math.sqrt(sum / n)), peak: db(peak), samples: n };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- streams ---------------------------------------------------------------
const streams = probeStreams();
const video = streams.filter((s) => s.codec_type === 'video');
const audio = streams.filter((s) => s.codec_type === 'audio');

console.log(`${path.basename(file)}`);
console.log(`  streams: ${streams.length} (${video.length} video, ${audio.length} audio)`);

if (video.length !== 1) failures.push(`expected exactly 1 video stream, found ${video.length}`);
if (audio.length !== 1) failures.push(`expected exactly 1 audio stream, found ${audio.length}`);

if (video[0]) {
  const v = video[0];
  console.log(`  video:   ${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}`);
  if (v.codec_name !== 'h264') failures.push(`video codec is ${v.codec_name}, expected h264`);
  if (v.width !== 1080 || v.height !== 1920) {
    failures.push(`video is ${v.width}x${v.height}, expected 1080x1920`);
  }
  if (v.r_frame_rate !== '30/1') failures.push(`video is ${v.r_frame_rate}fps, expected 30/1`);
}

if (audio[0]) {
  const a = audio[0];
  const kbps = a.bit_rate ? Math.round(Number(a.bit_rate) / 1000) : null;
  console.log(`  audio:   ${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch ${kbps ?? '?'}kbps`);
  if (a.codec_name !== 'aac') failures.push(`audio codec is ${a.codec_name}, expected aac`);
  // A stream that exists but carries no bitrate is the shape a broken mux
  // takes. Merely existing is not the bar.
  if (!kbps || kbps < 32) failures.push(`audio bitrate is ${kbps ?? 'absent'}kbps, expected ~128`);
}
failures.push(
  ...packetCoverageFailures({
    video: video[0],
    audio: audio[0],
    expectedSeconds: EXPECT,
    fps: 30,
  }),
);

// --- duration --------------------------------------------------------------
const format = probeFormat();
const duration = Number(format.duration);
const mb = (Number(format.size) / 1024 / 1024).toFixed(1);
console.log(
  `  length:  ${duration.toFixed(2)}s (${(duration / 60).toFixed(2)} min), ${mb} MB, ` +
    `${Math.round(Number(format.bit_rate) / 1000)}kbps overall`,
);
if (EXPECT !== null) {
  const drift = duration - EXPECT;
  const verdict = Math.abs(drift) <= DURATION_TOLERANCE ? 'ok' : 'OFF';
  console.log(`  drift:   ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}s from ${EXPECT}s — ${verdict}`);
  if (Math.abs(drift) > DURATION_TOLERANCE) {
    failures.push(
      `duration ${duration.toFixed(2)}s is ${Math.abs(drift).toFixed(2)}s from the expected ` +
        `${EXPECT}s. The timeline and the narration disagree — do not upload this.`,
    );
  }
}

// --- audio, sampled in the middle rather than at the header ----------------
if (audio.length > 0 && Number.isFinite(duration)) {
  const points = [0.25, 0.5, 0.75].map((f) => Math.max(0, duration * f));
  const levels = points.map((at) => ({ at, ...(levelAt(at) ?? { rms: -Infinity, peak: -Infinity }) }));
  for (const l of levels) {
    console.log(
      `  audio @${l.at.toFixed(0)}s: RMS ${l.rms.toFixed(1)} dBFS, peak ${l.peak.toFixed(1)} dBFS`,
    );
  }
  const alive = levels.filter((l) => l.rms > SILENCE_DBFS);
  if (alive.length === 0) {
    failures.push(
      `every sampled point is below ${SILENCE_DBFS} dBFS. The audio stream is present and ` +
        `silent — this is the failure that shipped as episode 1.`,
    );
  } else if (alive.length < levels.length) {
    // One quiet point can be a real pause between scenes, so this is a note
    // rather than a failure — but it is worth a listen.
    console.log(
      `  note:    ${levels.length - alive.length} of ${levels.length} sample points are silent; ` +
        `check that is a pause and not a dropped scene.`,
    );
  }
}

// --- verdict ---------------------------------------------------------------
if (failures.length > 0) {
  console.error(`\nFAILED ${failures.length} check${failures.length === 1 ? '' : 's'}:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nok — two streams, real audio, length as expected.');

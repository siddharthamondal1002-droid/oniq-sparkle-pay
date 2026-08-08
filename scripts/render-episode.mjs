#!/usr/bin/env node
// ONIQ episode assembler — the renderer half.
//
// WHY THIS IS NOT IN THE APP: the app is deployed to a Cloudflare Worker.
// There is no ffmpeg and no Chromium there, and a 20-minute render blows any
// serverless wall clock by orders of magnitude. So the app only ever QUEUES
// (src/lib/episode.server.ts) and this out-of-band worker, holding the service
// role, does the CPU work and writes the result back to storage.
//
// WHY ffmpeg AND NOT REMOTION: Remotion (remotion/) is the existing
// code-rendered pipeline and it stays exactly as it is for the promo. It
// drives a headless Chromium, screenshotting one frame at a time — fine for a
// 23-second promo, unusable for a 20-minute episode. ffmpeg is what Remotion
// itself shells out to for encoding, is already installed, and does Ken Burns
// (zoompan) and cross-dissolves (xfade) natively. Same host, same job table,
// no second job system.
//
// Usage:  node scripts/render-episode.mjs [--once] [--job <id>]
// Env:    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'video-gen';
const W = 1080;
const H = 1920;
const FPS = 30;
const SCALE = 0.06; // Ken Burns travel, ~6% — subtle by design
const PAN = 0.06;
const MIN_SCENE = 5;
const MAX_SCENE = 60;
const MAX_TOTAL = 20 * 60;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function run(bin, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-20000);
    });
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${err.slice(-1500)}`)),
    );
  });
}

function probeDuration(file) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', file,
    ]);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (c) => {
      const v = Number(out.trim());
      c === 0 && Number.isFinite(v) ? resolve(v) : reject(new Error('could not read media duration'));
    });
  });
}

async function download(remote, local) {
  const { data, error } = await db.storage.from(BUCKET).download(remote);
  if (error || !data) throw new Error(`missing asset: ${remote}`);
  await writeFile(local, Buffer.from(await data.arrayBuffer()));
}

/** zoompan expression for one scene. Frames, not seconds — zoompan counts frames. */
function motionFilter(motion, frames) {
  const n = Math.max(frames - 1, 1);
  // Oversample first: zoompan on a 1x source stair-steps visibly.
  const pre = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2}`;
  const common = `d=${frames}:s=${W}x${H}:fps=${FPS}`;
  const centre = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  switch (motion) {
    case 'zoomIn':
      return `${pre},zoompan=z='1+${SCALE}*on/${n}':${centre}:${common}`;
    case 'zoomOut':
      return `${pre},zoompan=z='${1 + SCALE}-${SCALE}*on/${n}':${centre}:${common}`;
    case 'panLeft':
      return `${pre},zoompan=z='${1 + PAN}':x='(iw-iw/zoom)*(1-on/${n})':y='ih/2-(ih/zoom/2)':${common}`;
    case 'panRight':
      return `${pre},zoompan=z='${1 + PAN}':x='(iw-iw/zoom)*(on/${n})':y='ih/2-(ih/zoom/2)':${common}`;
    default:
      return `${pre},scale=${W}:${H},loop=loop=${frames}:size=1:start=0,fps=${FPS},trim=end_frame=${frames}`;
  }
}

async function renderJob(job, dir) {
  const scenes = Array.isArray(job.timeline) ? job.timeline : [];
  if (!scenes.length) throw new Error('empty timeline');
  const notes = [];

  // --- pull assets and let narration length win over the requested duration
  for (const [i, s] of scenes.entries()) {
    s._still = path.join(dir, `still_${i}${path.extname(s.stillPath) || '.png'}`);
    await download(`stills/${s.stillPath}`, s._still);
    if (s.audioPath) {
      s._audio = path.join(dir, `audio_${i}${path.extname(s.audioPath) || '.mp3'}`);
      await download(`audio/${s.audioPath}`, s._audio);
      const real = Math.round((await probeDuration(s._audio)) * 1000) / 1000;
      const clamped = Math.min(Math.max(real, MIN_SCENE), MAX_SCENE);
      if (Math.abs(clamped - s.durationSeconds) > 0.05) {
        notes.push(
          `scene ${i + 1}: requested ${s.durationSeconds}s, narration is ${real}s -> using ${clamped}s` +
            (clamped !== real ? ' (clamped to the 5-60s scene bounds)' : ''),
        );
      }
      s.durationSeconds = clamped;
    }
    s.transitionSeconds = Math.min(
      s.transitionSeconds ?? 0,
      s.durationSeconds / 2,
      (scenes[i - 1]?.durationSeconds ?? s.durationSeconds) / 2,
    );
    if (i === 0) s.transitionSeconds = 0;
  }

  const total = scenes.reduce((a, s) => a + s.durationSeconds - s.transitionSeconds, 0);
  if (total > MAX_TOTAL) throw new Error(`timeline grew to ${Math.round(total / 60)} minutes after narration sync — cap is 20`);

  // --- one silent clip per scene (Ken Burns applied here) ------------------
  for (const [i, s] of scenes.entries()) {
    const frames = Math.max(Math.round(s.durationSeconds * FPS), 2);
    s._clip = path.join(dir, `scene_${i}.mp4`);
    await run('ffmpeg', [
      '-y', '-loop', '1', '-t', String(s.durationSeconds), '-i', s._still,
      '-filter_complex', motionFilter(s.motion, frames),
      '-frames:v', String(frames),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-r', String(FPS), s._clip,
    ]);
  }

  // --- chain the clips with cross-dissolves, then lay narration on top -----
  const inputs = [];
  scenes.forEach((s) => inputs.push('-i', s._clip));
  const audioScenes = scenes.filter((s) => s._audio);
  audioScenes.forEach((s) => inputs.push('-i', s._audio));

  const parts = [];
  let last = '[0:v]';
  let offset = scenes[0].durationSeconds;
  for (let i = 1; i < scenes.length; i += 1) {
    const t = scenes[i].transitionSeconds;
    const out = `[v${i}]`;
    if (t > 0) {
      parts.push(`${last}[${i}:v]xfade=transition=fade:duration=${t}:offset=${offset - t}${out}`);
      offset = offset - t + scenes[i].durationSeconds;
    } else {
      parts.push(`${last}[${i}:v]concat=n=2:v=1:a=0${out}`);
      offset += scenes[i].durationSeconds;
    }
    last = out;
  }
  const vOut = scenes.length > 1 ? last : '[0:v]';

  // Scene start times on the finished timeline (dissolves overlap).
  const starts = [];
  let cursor = 0;
  scenes.forEach((s, i) => {
    if (i > 0) cursor += -s.transitionSeconds;
    starts[i] = cursor;
    cursor += s.durationSeconds;
  });

  let aOut = null;
  if (audioScenes.length) {
    const labels = [];
    audioScenes.forEach((s, k) => {
      const idx = scenes.length + k;
      const ms = Math.round(starts[scenes.indexOf(s)] * 1000);
      parts.push(`[${idx}:a]aresample=48000,adelay=${ms}|${ms},apad[a${k}]`);
      labels.push(`[a${k}]`);
    });
    parts.push(
      `${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,atrim=0:${total},asetpts=N/SR/TB[aout]`,
    );
    aOut = '[aout]';
  }

  const out = path.join(dir, 'episode.mp4');
  await run('ffmpeg', [
    '-y', ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', vOut,
    ...(aOut ? ['-map', aOut, '-c:a', 'aac', '-b:a', '160k'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart', out,
  ]);

  return { out, notes, total };
}

async function claim(jobId) {
  const q = db.from('episode_jobs').select('*').eq('status', 'queued').order('created_at').limit(1);
  const { data } = jobId
    ? await db.from('episode_jobs').select('*').eq('id', jobId).limit(1)
    : await q;
  const job = data?.[0];
  if (!job) return null;
  const { data: claimed } = await db
    .from('episode_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('*')
    .maybeSingle();
  return claimed ?? null;
}

async function tick(jobId) {
  const job = await claim(jobId);
  if (!job) return false;
  console.log(`[episode] rendering ${job.id}`);
  const dir = await mkdtemp(path.join(tmpdir(), 'episode-'));
  try {
    const { out, notes, total } = await renderJob(job, dir);
    const stored = `episodes/${job.id}.mp4`;
    const { error } = await db.storage
      .from(BUCKET)
      .upload(stored, await readFile(out), { contentType: 'video/mp4', upsert: true });
    if (error) throw new Error(`upload failed: ${error.message}`);
    const size = (await stat(out)).size;
    await db
      .from('episode_jobs')
      .update({
        status: 'succeeded',
        stored_path: stored,
        total_seconds: Math.round(total * 1000) / 1000,
        notes: { durationNotes: notes, bytes: size },
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    console.log(`[episode] done ${stored} (${size} bytes, ${total}s)`);
  } catch (e) {
    // No automatic retry, on purpose: a failing render would burn CPU forever.
    await db
      .from('episode_jobs')
      .update({
        status: 'failed',
        error: String(e?.message ?? e).slice(0, 800),
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    console.error(`[episode] failed ${job.id}: ${e?.message ?? e}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return true;
}

const args = process.argv.slice(2);
const once = args.includes('--once');
const jobId = args.includes('--job') ? args[args.indexOf('--job') + 1] : null;

if (once || jobId) {
  const did = await tick(jobId);
  if (!did) console.log('[episode] nothing queued');
} else {
  for (;;) {
    const did = await tick(null);
    if (!did) await new Promise((r) => setTimeout(r, 5000));
  }
}

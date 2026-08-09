// The Story worker: takes one queued job and turns it into a finished file.
//
//   cd remotion && node scripts/story-worker.mjs
//   PLAN=/path/plan.json OUT=/path/out.mp4 node scripts/story-worker.mjs   # offline
//
// RUN IT WITH NODE, NOT BUN, like every render script here.
//
// ONE JOB PER RUN, and that is the design rather than a limitation. The guard
// order this project enforces ends with "then the billable call", and a worker
// that drains a queue in a loop turns one bad plan into a bill. A scheduler
// runs this again; it does not loop.
//
// WHAT IT DOES, in the order storyLifecycle allows:
//
//   queued      claim the oldest job, move it to `generating`
//   generating  Ting writes the plot (story-plot), Gemini draws each still
//               (story-still) and reads each line (story-voice), one call per
//               shot each
//   assembling  Remotion renders the plan to mp4
//   ready       upload, record the path, set has_bytes
//
// Any failure moves the job to `failed` and refunds the seconds. The sweeper
// then reclaims the bytes, because every path in the lifecycle ends in
// `purged`.
//
// ONE HONEST GAP:
//
//   - It has never run against the live project. There is no Supabase reachable
//     from this session, so the offline path (PLAN=) is the one that has been
//     exercised. Treat the online path as unverified code.
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import { findChromium } from './findChromium.mjs';
import { findBin } from './findFfmpeg.mjs';
import { envelope, speechSpans } from './speech.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLAN_FILE = process.env.PLAN;
const OUT = process.env.OUT ?? path.resolve(__dirname, '../../.tmp/story.mp4');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const FPS = 30;

const offline = Boolean(PLAN_FILE);
if (!offline && (!SUPABASE_URL || !SERVICE_KEY)) {
  throw new Error(
    'set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or PLAN=<file> to render a plan offline',
  );
}

// --- supabase, over plain fetch ---------------------------------------------
// No client library: this runs in CI where the dependency tree is the thing
// most likely to break, and three REST calls do not justify one.
async function db(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${pathname}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args ?? {}),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function edge(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  if (json.configured === false) throw new Error(`${fn}: not configured — no API key`);
  if (json.error) throw new Error(`${fn}: ${json.error}`);
  return json;
}

/** Move a job on, letting the DB trigger reject an illegal transition. */
async function setStatus(id, status, extra = {}) {
  await db(`story_jobs?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status, ...extra }),
  });
}

// --- the render -------------------------------------------------------------
async function renderPlan(plan, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const bundled = await bundle({
    entryPoint: path.resolve(__dirname, '../src/story.ts'),
    webpackOverride: (c) => c,
  });
  const browser = await openBrowser('chrome', {
    browserExecutable: findChromium(),
    chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
    chromeMode: 'chrome-for-testing',
  });
  try {
    const composition = await selectComposition({
      serveUrl: bundled,
      id: 'story',
      puppeteerInstance: browser,
      inputProps: plan,
    });
    const started = Date.now();
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      outputLocation: outFile,
      puppeteerInstance: browser,
      inputProps: plan,
      // NOT muted. A silent Story is the failure this project already shipped.
      muted: false,
      concurrency: CONCURRENCY,
      crf: 28,
      audioBitrate: '128k',
    });
    const seconds = (Date.now() - started) / 1000;
    const videoSeconds = composition.durationInFrames / composition.fps;
    console.log(
      `rendered ${composition.durationInFrames} frames in ${seconds.toFixed(1)}s ` +
        `(${(videoSeconds / seconds).toFixed(3)}x realtime)`,
    );
  } finally {
    // Destructures its argument — a bare close() throws AFTER the mp4 is on
    // disk, which reads as a render failure and is not one.
    await browser.close({ silent: true });
  }
}

/**
 * Wrap Gemini's raw PCM in a WAV header.
 *
 * story-voice returns signed 16-bit little-endian mono PCM with no container,
 * because the function has no business inventing a header and this side already
 * has ffmpeg. 44 bytes of RIFF is cheaper than shelling out.
 */
function wrapPcmAsWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);   // PCM
  header.writeUInt16LE(1, 22);   // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);   // block align
  header.writeUInt16LE(16, 34);  // bits
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Sample rate out of "audio/L16;codec=pcm;rate=24000". */
function rateOf(mime) {
  const m = /rate=(\d+)/.exec(mime ?? '');
  const n = m ? Number(m[1]) : NaN;
  // Guessing here would produce audio at the wrong speed, which reads as a
  // strange voice rather than as a bug.
  if (!Number.isFinite(n) || n <= 0) throw new Error(`story-voice: no sample rate in "${mime}"`);
  return n;
}

/**
 * Which rigged character, if any, belongs in this shot.
 *
 * Only characters with a MEASURED rig can appear. Today that is Aladdin alone,
 * so a user's Story gets no puppet unless their plan names him — which is
 * correct rather than unfortunate: the alternative is a guessed mouth anchor.
 */
function rigFor(plan, shot) {
  const text = `${shot.still} ${shot.narration}`.toLowerCase();
  for (const member of plan.cast ?? []) {
    const key = String(member.name ?? '').toLowerCase();
    if (key && text.includes(key) && MEASURED_RIGS.has(key)) return key;
  }
  return null;
}

/** Kept in step with CHARACTER_RIGS by hand; the render just skips an unknown key. */
const MEASURED_RIGS = new Set(['aladdin']);

/** ffprobe duration, because narration is the clock and estimates drift. */
function secondsOf(file) {
  const out = execFileSync(findBin('ffprobe'), [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]).toString().trim();
  const n = Number(out);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${file}: unreadable duration "${out}"`);
  return n;
}

// --- offline path: render a plan from disk ----------------------------------
if (offline) {
  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  if (!Array.isArray(plan.shots) || plan.shots.length === 0) {
    throw new Error(`${PLAN_FILE}: no shots`);
  }
  // Durations are MEASURED here too, so the offline path cannot drift from the
  // online one by trusting a number somebody typed.
  for (const shot of plan.shots) {
    if (shot.audio) {
      const abs = path.resolve(__dirname, '../public', shot.audio);
      if (fs.existsSync(abs)) shot.seconds = secondsOf(abs);
    }
    if (!shot.seconds) throw new Error(`shot "${shot.still}" has no duration and no audio`);
  }
  console.log(`${plan.title}: ${plan.shots.length} shots -> ${OUT}`);
  await renderPlan(plan, OUT);
  console.log(`${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
} else {
  // --- online path: claim a job and run it ----------------------------------
  const queued = await db(
    'story_jobs?status=eq.queued&order=created_at.asc&limit=1&select=id,user_id,prompt,requested_seconds,shot_count',
  );
  if (!queued || queued.length === 0) {
    console.log('nothing queued');
    process.exit(0);
  }
  const job = queued[0];
  console.log(`job ${job.id}: ${job.requested_seconds}s`);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  try {
    await setStatus(job.id, 'generating');

    // The shot count comes from the row, which the enqueuing side filled from
    // planStory(). It is NOT recomputed here — a second shot planner would
    // drift from the first and nobody would notice until a Story came back the
    // wrong length.
    const shots = job.shot_count;
    if (!shots) throw new Error('job has no shot_count — planStory never ran');

    const { plan } = await edge('story-plot', { prompt: job.prompt, shots });
    console.log(`  plot: "${plan.title}", ${plan.shots.length} shots`);

    // One voice for the whole film. A narrator that changes between shots is
    // the audio version of the character drift the cast locks exist to fix.
    const voice = process.env.STORY_VOICE ?? 'Charon';
    const ffmpeg = findBin('ffmpeg');
    const rendered = [];
    for (const [i, shot] of plan.shots.entries()) {
      // One call per shot, sequentially. Not a fan-out: the rate limit is per
      // call and a loop that ignores it is how a month of credits goes in an
      // hour.
      const still = await edge('story-still', {
        prompt: `${shot.still}\n\nSetting: ${plan.setting}`,
      });
      const file = path.join(work, `shot${String(i).padStart(3, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(still.data, 'base64'));
      console.log(`  still ${i + 1}/${plan.shots.length}`);

      const voiced = await edge('story-voice', { text: shot.narration, voice });
      const wav = path.join(work, `shot${String(i).padStart(3, '0')}.wav`);
      fs.writeFileSync(wav, wrapPcmAsWav(Buffer.from(voiced.data, 'base64'), rateOf(voiced.mime)));

      // MEASURED, both of them. The duration decides how long the shot is on
      // screen — narration is the clock and a word-count estimate drifts
      // further out of sync with every shot. The spans decide when the mouth
      // moves, and they come from the same envelope the episodes use, imported
      // rather than reimplemented so the two cannot disagree.
      const seconds = secondsOf(wav);
      const durationFrames = Math.max(1, Math.round(seconds * FPS));
      const spans = speechSpans(envelope(ffmpeg, wav)).filter(([a]) => a < durationFrames);

      rendered.push({
        still: file,
        audio: wav,
        seconds,
        // Camera per shot rather than a house constant: measured across six ep3
        // clips it ran 0.0 to 19.2 percent, half of them locked off.
        travel: i % 3 === 0 ? 0 : 0.03,
        pan: i % 2 === 0 ? 'right' : 'left',
        // A character only where the plan says someone is on screen AND that
        // someone has a measured rig. An unmeasured character would need a
        // guessed mouth anchor, which looks like it works until the mouth opens
        // near the chin.
        ...(rigFor(plan, shot)
          ? { character: { rig: rigFor(plan, shot), text: shot.narration, speech: spans } }
          : {}),
      });
      console.log(`  voice ${i + 1}/${plan.shots.length} — ${seconds.toFixed(2)}s, ${spans.length} spans`);
    }

    await setStatus(job.id, 'assembling');
    const outFile = path.join(work, 'story.mp4');
    await renderPlan({ title: plan.title, shots: rendered }, outFile);

    const storagePath = `stories/${job.user_id}/${job.id}.mp4`;
    const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/video-gen/${storagePath}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'content-type': 'video/mp4',
      },
      body: fs.readFileSync(outFile),
    });
    if (!upload.ok) throw new Error(`upload: ${upload.status} ${await upload.text()}`);

    await setStatus(job.id, 'ready', { storage_path: storagePath, has_bytes: true });
    console.log(`job ${job.id} ready at ${storagePath}`);
  } catch (e) {
    console.error(`job ${job.id} failed:`, e.message);
    // Mark failed FIRST, then refund. If the refund throws, the job is still
    // marked and the sweeper will reclaim its bytes; the reverse order can
    // refund a job that then looks live.
    await setStatus(job.id, 'failed', { error: String(e.message).slice(0, 500) }).catch(() => {});
    await rpc('refund_story_seconds', { _job_id: job.id }).catch((err) =>
      console.error('refund failed:', err.message),
    );
    process.exitCode = 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

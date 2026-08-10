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
//   queued      claim the job, move it to `generating`
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
// TWO MODES, and dispatch is the real one:
//
//   dispatch  STORY_JOB_TOKEN is set, because story-dispatch sent this run a
//             capability token scoped to one job for one hour. The runner holds
//             NO Supabase credential: claim, assembling, the upload URL, ready
//             and failed all go through story-callback, which checks the token
//             names the job before using the service role on its behalf.
//   polling   SUPABASE_SERVICE_ROLE_KEY is set and the runner takes the oldest
//             queued job itself. For operating this by hand.
//
// WHAT HAS ACTUALLY BEEN RUN. The dispatch path has been exercised end to end
// against a mock of the four functions: claim -> assembling -> upload-url ->
// ready, two shots, and the resulting 1080x1920 mp4 carried an aac track
// peaking at -14.7 dBFS. That last number is the one that matters — episode one
// shipped as a silent slideshow with all twelve mp3s generated and none of them
// mounted, and only measuring the audio in the finished file catches it.
//
// The mock caught a real defect that a code review had not: the plan reaches
// the browser through staticFile(), which rejects absolute paths, so writing
// the stills to a temp directory failed AFTER every image and every line had
// been paid for. Assets are written under public/ for that reason.
//
// STILL UNVERIFIED: the live project. Nothing here has spoken to the real
// Supabase or the real Gemini key.
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
import { framingFor, isMoving } from '../../src/lib/shotGrammar.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Trailing slashes stripped. `${url}/functions/v1/x` with a trailing slash
// becomes a double slash, which the gateway answers with a 404 that reads
// exactly like a missing function.
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '') || undefined;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// DISPATCH MODE. Supabase sent us here with one job and a token scoped to it,
// so this runner needs no Supabase key at all: every read, every state change
// and even the upload go through story-callback, which checks the token names
// the job before using the service role on its behalf.
const JOB_TOKEN = process.env.STORY_JOB_TOKEN;
const dispatched = Boolean(JOB_TOKEN);
const PLAN_FILE = process.env.PLAN;
const OUT = process.env.OUT ?? path.resolve(__dirname, '../../.tmp/story.mp4');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const FPS = 30;

const offline = Boolean(PLAN_FILE);
if (!offline && !SUPABASE_URL) {
  throw new Error('SUPABASE_URL is required');
}
if (!offline && !dispatched && !SERVICE_KEY) {
  throw new Error(
    'no STORY_JOB_TOKEN (dispatch mode) and no SUPABASE_SERVICE_ROLE_KEY (polling mode); ' +
      'or set PLAN=<file> to render a plan offline',
  );
}

/**
 * Ask story-callback to do something on this job's behalf.
 *
 * THE RAW BODY GOES IN THE ERROR, not just `body.error`. The first live run
 * failed with `story-callback claim: 404` and nothing after it — and that empty
 * space was the whole diagnosis, because story-callback's own 404 always
 * carries "no such job". A blank meant the GATEWAY answered, i.e. the function
 * was not at that URL at all. An error message that only prints the fields it
 * expects hides the case where something else replied.
 */
async function callback(action, extra = {}) {
  const url = `${SUPABASE_URL}/functions/v1/story-callback`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, token: JOB_TOKEN, ...extra }),
  });
  const raw = await res.text();
  let body = {};
  try {
    body = JSON.parse(raw);
  } catch {
    // Not JSON at all, which is itself the finding — the gateway and a proxy
    // both answer in HTML.
  }
  if (!res.ok || body?.error) {
    throw new Error(
      `story-callback ${action}: ${res.status} ${body?.error ?? raw.slice(0, 200)} (POST ${url})`,
    );
  }
  return body;
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
  // In dispatch mode the job token IS the credential. The generation functions
  // accept it via x-story-job-token because a runner is not a user and
  // /auth/v1/user would reject anything it could present — including the
  // service-role key, which is not a user JWT either.
  const headers = { 'content-type': 'application/json' };
  if (dispatched) headers['x-story-job-token'] = JOB_TOKEN;
  else headers.Authorization = `Bearer ${SERVICE_KEY}`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: 'POST',
    headers,
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

// --- one job, two ways of reaching it ---------------------------------------
// Everything below the claim is identical in both modes, so the difference is
// confined to these four functions rather than sprinkled through the render.
// Dispatch is the real path; polling exists to operate the thing by hand.

/**
 * Take the job this run is for, and get back what is needed to build it.
 *
 * In dispatch mode the claim is a single call: story-callback moves the row to
 * `generating` with a `status=eq.queued` filter and returns the prompt in the
 * same response, so the runner never reads the table. Returns null when there
 * is nothing to do, which is a normal exit and not a failure.
 */
async function claimJob() {
  if (dispatched) {
    try {
      const got = await callback('claim');
      return { id: got.jobId, prompt: got.prompt, shotCount: got.shotCount };
    } catch (e) {
      // 409 means another runner won the race, or Supabase re-dispatched a job
      // that is already generating. Neither is an error worth failing a run
      // over — and crucially, neither should mark the job failed, because the
      // runner that DID claim it is still working.
      if (/\b409\b|already claimed|job is /.test(e.message)) {
        console.log(`nothing to claim (${e.message})`);
        return null;
      }
      throw e;
    }
  }

  const queued = await db(
    'story_jobs?status=eq.queued&order=created_at.asc&limit=1&select=id,user_id,prompt,requested_seconds,shot_count',
  );
  if (!queued || queued.length === 0) return null;
  const row = queued[0];
  await setStatus(row.id, 'generating');
  return { id: row.id, userId: row.user_id, prompt: row.prompt, shotCount: row.shot_count };
}

/** `assembling`. Its own function only so the two modes stay symmetrical. */
async function markAssembling(job) {
  if (dispatched) await callback('assembling');
  else await setStatus(job.id, 'assembling');
}

/**
 * Put the finished mp4 where the app can serve it, and return its path.
 *
 * The signed URL is minted by story-callback from the JOB ID, never from
 * anything this runner sends — a runner that could name its own object path
 * could overwrite somebody else's Story.
 */
async function uploadFinished(job, file) {
  const bytes = fs.readFileSync(file);
  if (dispatched) {
    const { uploadUrl, storagePath } = await callback('upload-url');
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'video/mp4' },
      body: bytes,
    });
    if (!put.ok) throw new Error(`upload: ${put.status} ${await put.text()}`);
    return storagePath;
  }

  const storagePath = `stories/${job.userId}/${job.id}.mp4`;
  const upload = await fetch(`${SUPABASE_URL}/storage/v1/object/video-gen/${storagePath}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'video/mp4',
    },
    body: bytes,
  });
  if (!upload.ok) throw new Error(`upload: ${upload.status} ${await upload.text()}`);
  return storagePath;
}

async function markReady(job, storagePath, shotCount) {
  if (dispatched) await callback('ready', { storagePath, shotCount });
  else await setStatus(job.id, 'ready', { storage_path: storagePath, has_bytes: true });
}

/**
 * Mark failed and give the seconds back.
 *
 * In dispatch mode the refund happens inside story-callback, where the service
 * role already is — one call, and the runner cannot choose to skip the refund.
 * Marking comes first in both modes: if the refund throws, the job is still
 * marked and the sweeper reclaims its bytes, whereas the reverse order can
 * refund a job that then looks live.
 */
async function markFailed(job, message) {
  const error = String(message).slice(0, 500);
  if (dispatched) {
    await callback('failed', { error }).catch((err) =>
      console.error('could not mark failed:', err.message),
    );
    return;
  }
  await setStatus(job.id, 'failed', { error }).catch(() => {});
  await rpc('refund_story_seconds', { _job_id: job.id }).catch((err) =>
    console.error('refund failed:', err.message),
  );
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
  console.log(dispatched ? `dispatch mode: job ${process.env.STORY_JOB_ID ?? '?'}` : 'polling mode');
  const job = await claimJob();
  if (!job) {
    console.log('nothing queued');
    process.exit(0);
  }
  console.log(`job ${job.id}: ${job.shotCount} shots`);

  // THE STILLS AND THE NARRATION MUST LIVE UNDER public/, not in a temp dir.
  // StoryFilm resolves a non-URL path with staticFile(), which rejects an
  // absolute path outright — the first dispatch run died on exactly that, after
  // paying for every image and every line. Remotion's bundler serves this
  // folder off disk, so files written here before bundle() are picked up.
  //
  // The directory is named from the job so two runners cannot tread on each
  // other, and it is removed in `finally` whatever happens: these are the
  // user's frames, and the lifecycle this feature is built around ends every
  // path in `purged`.
  const assetDir = `.story-${String(job.id).replace(/[^a-zA-Z0-9-]/g, '')}`;
  const assetRoot = path.resolve(__dirname, '../public', assetDir);
  fs.mkdirSync(assetRoot, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  try {
    // The shot count comes from the row, which the enqueuing side filled from
    // planStory(). It is NOT recomputed here — a second shot planner would
    // drift from the first and nobody would notice until a Story came back the
    // wrong length.
    const shots = job.shotCount;
    if (!shots) throw new Error('job has no shot_count — planStory never ran');

    const { plan } = await edge('story-plot', { prompt: job.prompt, shots });
    console.log(`  plot: "${plan.title}", ${plan.shots.length} shots`);

    // One voice for the whole film. A narrator that changes between shots is
    // the audio version of the character drift the cast locks exist to fix.
    const voice = process.env.STORY_VOICE ?? 'Charon';
    const ffmpeg = findBin('ffmpeg');
    const rendered = [];
    let movingShots = 0;
    for (const [i, shot] of plan.shots.entries()) {
      // One call per shot, sequentially. Not a fan-out: the rate limit is per
      // call and a loop that ignores it is how a month of credits goes in an
      // hour.
      const still = await edge('story-still', {
        prompt: `${shot.still}\n\nSetting: ${plan.setting}`,
      });
      const stem = `shot${String(i).padStart(3, '0')}`;
      const stillFile = path.join(assetRoot, `${stem}.png`);
      fs.writeFileSync(stillFile, Buffer.from(still.data, 'base64'));
      console.log(`  still ${i + 1}/${plan.shots.length}`);

      // The camera comes from what the SHOT IS, read off Ting's own size word,
      // not from the shot's position in the film. `movingShots` counts only the
      // shots that actually move, so two pans either side of a locked shot
      // still go opposite ways.
      const framing = framingFor(shot.still, movingShots);
      if (isMoving(framing)) movingShots += 1;

      const voiced = await edge('story-voice', { text: shot.narration, voice });
      const wav = path.join(assetRoot, `${stem}.wav`);
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
        // Relative to public/, because that is what staticFile() takes. Posix
        // separators explicitly: this is a URL path once it reaches the
        // browser, not a filesystem path.
        still: `${assetDir}/${stem}.png`,
        audio: `${assetDir}/${stem}.wav`,
        seconds,
        // Camera per shot rather than a house constant: measured across six ep3
        // clips it ran 0.0 to 19.2 percent, half of them locked off.
        travel: framing.travel,
        pan: framing.pan,
        figureHeight: framing.figureHeight,
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

    await markAssembling(job);
    const outFile = path.join(work, 'story.mp4');
    await renderPlan({ title: plan.title, shots: rendered }, outFile);

    const storagePath = await uploadFinished(job, outFile);
    await markReady(job, storagePath, rendered.length);
    console.log(`job ${job.id} ready at ${storagePath}`);
  } catch (e) {
    console.error(`job ${job.id} failed:`, e.message);
    await markFailed(job, e.message);
    process.exitCode = 1;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(assetRoot, { recursive: true, force: true });
  }
}

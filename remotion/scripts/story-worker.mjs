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
import { framingFor, isSlide } from '../../src/lib/shotGrammar.ts';
import { rhubarbCuesForWav } from './rhubarb.mjs';
import { applyFilmLook } from './filmLook.mjs';
import { ensureDepthModel, inferDepth, cutNearPlane } from './depth.mjs';
import { defaultTtsCache, ensureLocalTts, speakerFor, synthLocal } from './localTts.mjs';
import {
  PARALLAX,
  bandAlpha,
  nearPlaneAlpha,
  normalizeDepth,
  planeCoverage,
} from '../../src/lib/parallaxPlanes.ts';
import { vfxKindFor, vfxSeed } from '../../src/lib/particleField.ts';
import { emotionFor } from '../../src/lib/expressionGrammar.ts';
import { ambienceFor, ambienceGraph, scoreFor, scoreGraph } from '../../src/lib/soundStage.ts';
import {
  TWO_SHOT_MAX_FIGURE_HEIGHT,
  centerForFacing,
  conversationFacings,
  oppositeFacing,
  riggedMentions,
  speakerMatchesRig,
  walkFor,
} from '../../src/lib/puppetPerformance.ts';
import { planStory } from '../../src/lib/storyPlan.ts';
import { composeVideoPrompt } from '../../supabase/functions/_shared/movieGrammar.ts';

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
  // 500, not 200. story-plot returns a `tried` array naming why each engine
  // failed, and 200 characters cut it off exactly where it got interesting.
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${JSON.stringify(json).slice(0, 500)}`);
  if (json.configured === false) throw new Error(`${fn}: not configured — no API key`);
  if (json.error) throw new Error(`${fn}: ${json.error}`);
  return json;
}

/**
 * story-voice, paced and with patience for a throttle.
 *
 * MEASURED, not guessed: run 65 named the failure `upstream 429`. A shot
 * fires narration and dialogue back to back, which is ~9-10 TTS calls a
 * minute — riding exactly at a 10-requests-per-minute quota — and once the
 * rolling window saturates, a 20-40s wait only part-drains it before the
 * next burst refills it; run 65 lost a narration to three straight 429s
 * that way. Two answers, both here:
 *
 *   PACING. Every attempt waits out a fixed gap since the previous voice
 *   call, turning bursts of two into a steady ~9/min that stays under the
 *   window instead of slamming it.
 *
 *   PATIENCE. A 502 earns growing waits (30/60/90s) — long enough for a
 *   saturated minute to actually roll over. The no-retry house rule is
 *   about refusals, which fail identically the second time; a throttle is
 *   the one failure where waiting IS the fix. Anything that is not a 502
 *   still throws straight through. Narration gets four attempts because it
 *   is the film's clock; dialogue gets two before its existing skip.
 */
const VOICE_GAP_MS = 6_500;
let lastVoiceAt = 0;
async function voiceWithRetry(payload, attempts) {
  for (let a = 1; ; a++) {
    const gap = lastVoiceAt + VOICE_GAP_MS - Date.now();
    if (gap > 0) await new Promise((r) => setTimeout(r, gap));
    lastVoiceAt = Date.now();
    try {
      return await edge('story-voice', payload);
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (a >= attempts || !/story-voice: 502/.test(msg)) throw err;
      const wait = 30_000 * a;
      console.log(`  voice retry in ${wait / 1000}s (${msg.slice(0, 100)})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
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
      return {
        id: got.jobId,
        prompt: got.prompt,
        requestedSeconds: got.requestedSeconds,
        shotCount: got.shotCount,
        castJson: got.castJson ?? null,
        noWatermark: got.noWatermark === true,
        grade: got.grade === 'movie' ? 'movie' : 'classic',
      };
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
    'story_jobs?status=eq.queued&order=created_at.asc&limit=1&select=id,user_id,prompt,requested_seconds,shot_count,cast_json,no_watermark,grade',
  );
  if (!queued || queued.length === 0) return null;
  const row = queued[0];
  await setStatus(row.id, 'generating');
  return {
    id: row.id,
    userId: row.user_id,
    prompt: row.prompt,
    requestedSeconds: row.requested_seconds,
    shotCount: row.shot_count,
    castJson: row.cast_json ?? null,
    noWatermark: row.no_watermark === true,
    grade: row.grade === 'movie' ? 'movie' : 'classic',
  };
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
  // THREE ATTEMPTS AT THE BROWSER, because a launch flake after generation is
  // the most expensive 25 seconds in the pipeline. Run 73 lost a fully-paid
  // film — every still, every clip, every voice — to one "timed out
  // connecting to the browser" on a runner that had launched the identical
  // build an hour earlier. A launch timeout is transient runner weather, not
  // a verdict; a refusal-style no-retry rule does not apply to it.
  let browser;
  for (let a = 1; ; a++) {
    try {
      browser = await openBrowser('chrome', {
        browserExecutable: findChromium(),
        chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
        chromeMode: 'chrome-for-testing',
      });
      break;
    } catch (err) {
      if (a >= 3) throw err;
      console.log(
        `browser launch failed (attempt ${a}/3) — again in 20s: ` +
          String(err?.message ?? err).slice(0, 120),
      );
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
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
 * Only characters with a MEASURED rig can appear — the alternative is a
 * guessed mouth anchor. Since rung 2 (2026-08-13) the whole eleven-sheet
 * repertory is measured, so a plan naming a princess, a fisherman or a
 * magician gets a speaking puppet, not just one naming Aladdin.
 *
 * A cast NAME is prose ("Ali Baba", "The Magician") while a rig KEY is an
 * identifier ("aliBaba", "magician"), so the match strips "the " and every
 * non-alphanumeric before comparing — and returns the KEY, because that is
 * what the composition indexes CHARACTER_RIGS with.
 */
function rigFor(plan, shot) {
  const text = `${shot.still} ${shot.narration}`.toLowerCase();
  for (const member of plan.cast ?? []) {
    const name = String(member.name ?? '').toLowerCase();
    if (!name || !text.includes(name)) continue;
    const key = RIG_KEY_BY_NAME.get(name.replace(/^the\s+/, '').replace(/[^a-z0-9]/g, ''));
    if (key) return key;
  }
  return null;
}

/** Kept in step with CHARACTER_RIGS by hand; characterRigs.test.ts pins the sync. */
const MEASURED_RIGS = new Set([
  'aladdin',
  'aliBaba',
  'captain',
  'fisherman',
  'jarJinni',
  'lampJinni',
  'magician',
  'morgiana',
  'mother',
  'princess',
  'ringJinni',
]);
/** 'alibaba' -> 'aliBaba': normalized prose name to rig key. */
const RIG_KEY_BY_NAME = new Map([...MEASURED_RIGS].map((k) => [k.toLowerCase(), k]));


/**
 * The film look, as a step-down stage: grade the master in place, and if the
 * grade fails for any reason ship the clean master instead. One to two cents
 * of CPU per finished minute, most of the visible "filmed" quality, and
 * STORY_FILM_LOOK=off turns it off without a deploy.
 */
function gradeInPlace(file) {
  if ((process.env.STORY_FILM_LOOK ?? 'on') === 'off') {
    console.log('film look: off by env');
    return;
  }
  const graded = `${file}.look.mp4`;
  try {
    const t0 = Date.now();
    applyFilmLook(findBin('ffmpeg'), file, graded);
    fs.renameSync(graded, file);
    console.log(`film look: graded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    fs.rmSync(graded, { force: true });
    console.log(`film look: skipped (${err?.message ?? err}) — shipping the clean master`);
  }
}


/**
 * The depth model, fetched once per run and failing CLOSED for the whole
 * film: if the 66MB MiDaS download or its sha256 pin fails, every shot ships
 * as plain Ken Burns and one log line says why. Never per-shot retries — a
 * host that refused the model once will refuse it nine times, and the render
 * budget belongs to frames.
 */
let depthModelPromise = null;
function depthModel() {
  if ((process.env.STORY_PARALLAX ?? 'on') === 'off') return Promise.resolve(null);
  if (!depthModelPromise) {
    const cache = process.env.DEPTH_MODEL_CACHE ?? path.join(os.tmpdir(), 'oniq-depth-cache');
    depthModelPromise = ensureDepthModel(cache).catch((err) => {
      console.log(`parallax: depth model unavailable (${err?.message ?? err})`);
      return null;
    });
  }
  return depthModelPromise;
}

/**
 * The in-house voice, fetched lazily and once. STORY_LOCAL_TTS=off disables
 * the fallback entirely (a film then dies where it used to when the cloud
 * bucket is dry); a download or verify failure logs and returns null, so a
 * broken mirror degrades to exactly the old behaviour instead of a crash.
 */
let localTtsPromise = null;
function localTts() {
  if ((process.env.STORY_LOCAL_TTS ?? 'on') === 'off') return Promise.resolve(null);
  if (!localTtsPromise) {
    localTtsPromise = Promise.resolve()
      .then(() => ensureLocalTts(defaultTtsCache()))
      .catch((err) => {
        console.log(`local tts unavailable (${err?.message ?? err})`);
        return null;
      });
  }
  return localTtsPromise;
}

/**
 * One Veo clip for one shot — the episode-3 architecture, per user film.
 *
 * The still is the plate: story-still already drew what the frame IS, and the
 * video model receives it as the starting frame plus a prompt describing ONLY
 * what moves (composeVideoPrompt: motion + vfx + dialogue — never cast locks,
 * never style; both were measured on ep3 to invite refusals and drift while
 * buying nothing).
 *
 * ONE RETRY, ON A REFUSAL ONLY. Ep3 measured Veo's third-party-content filter
 * as sampling-flaky: the same image and prompt were refused repeatedly, then
 * passed on a plain retry. So a 422 earns exactly one more attempt before the
 * shot steps down to the stills path. A timeout or any other failure is real
 * and throws straight through to the same step-down.
 */
const CLIP_POLL_MS = 10_000;
const CLIP_WAIT_MS = 6 * 60_000;
async function generateClip(shot, stillFile, shotSeconds) {
  const prompt = composeVideoPrompt(shot).slice(0, 1900);
  const imageBase64 = fs.readFileSync(stillFile).toString('base64');
  // Veo's menu is 4, 6 or 8 seconds — no 10, no extend. Ask for the longest
  // that the narration can use; the composition freezes the last frame under
  // whatever narration outlasts it.
  const ask = shotSeconds >= 6.5 ? 8 : shotSeconds >= 4.5 ? 6 : 4;
  for (let attempt = 1; ; attempt++) {
    try {
      const started = await edge('story-clip', {
        action: 'start',
        prompt,
        imageBase64,
        imageMime: 'image/png',
        seconds: ask,
      });
      const t0 = Date.now();
      for (;;) {
        if (Date.now() - t0 > CLIP_WAIT_MS) throw new Error('clip: timed out');
        await new Promise((r) => setTimeout(r, CLIP_POLL_MS));
        const got = await edge('story-clip', { action: 'poll', operation: started.operation });
        if (got.done) return got;
      }
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (attempt === 1 && /story-clip: 422/.test(msg)) {
        console.log('    clip refused — one retry, the filter is sampling-flaky');
        continue;
      }
      // A 502 in under a second is the submission being turned away, not a
      // generation failing — run 73's shots 8 and 9 died exactly there after
      // ten rapid submissions, which reads as a per-minute quota. A throttle
      // is the one failure where waiting IS the fix (the story-voice lesson),
      // so it earns one paced retry before the shot steps down to stills.
      if (attempt === 1 && /story-clip: 502/.test(msg)) {
        console.log('    clip upstream busy — one retry in 45s');
        await new Promise((r) => setTimeout(r, 45_000));
        continue;
      }
      throw err;
    }
  }
}

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
  gradeInPlace(OUT);
  console.log(`${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
} else {
  // --- online path: claim a job and run it ----------------------------------
  console.log(dispatched ? `dispatch mode: job ${process.env.STORY_JOB_ID ?? '?'}` : 'polling mode');
  const job = await claimJob();
  if (!job) {
    console.log('nothing queued');
    process.exit(0);
  }
  // Logged AFTER the shot count is settled, not before. The first run printed
  // "null shots" and then worked from 4, which reads as a bug that is not there.
  console.log(`job ${job.id}: ${job.requestedSeconds}s requested`);

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
    // THE SHOT COUNT IS DERIVED HERE, FROM THE SAME planStory THE APP USES.
    //
    // It used to be read off the row and the row never had it: the claim RPC
    // takes seconds and a prompt, so `shot_count` was null on every job and the
    // first Story to get this far died on "planStory never ran". Trusting the
    // row was the mistake — but so is trusting the CLIENT to send it, because
    // shot count is a cost input. A browser that posts 500 buys 500 images for
    // a thirty-second film, and the guard order this project enforces puts
    // validation before the billable call for exactly that reason.
    //
    // Deriving it server-side from `requested_seconds` closes both: nothing to
    // forge, and no second planner to drift, because this is literally the
    // function the button used to draw "30s · 4 shots".
    const shots = job.shotCount || planStory(job.requestedSeconds).shots.length;
    if (!shots) {
      throw new Error(`job has neither shot_count nor requested_seconds (${job.requestedSeconds})`);
    }
    console.log(`  ${shots} shots${job.shotCount ? ' (from the row)' : ' (derived from seconds)'}`);

    // The library cast rides to the planner as `reuse` — story-plot bounds and
    // validates it, and tells Ting to keep these people, verbatim.
    //
    // ONE RETRY ON A 502, because a plot 502 is the function's whole engine
    // chain running out of ITS wall clock — run 68 died on "batch 1:
    // timeout" after five straight runs where the same call succeeded, which
    // is transient model latency, not a prompt problem. A second invocation
    // gets a fresh 115-second budget and its own internal retries; a second
    // 502 in a row fails the job as before.
    let planRes;
    for (let a = 1; ; a++) {
      try {
        planRes = await edge('story-plot', {
          prompt: job.prompt,
          shots,
          ...(Array.isArray(job.castJson) && job.castJson.length ? { reuse: job.castJson } : {}),
        });
        break;
      } catch (err) {
        const msg = String(err?.message ?? err);
        if (a >= 2 || !/story-plot: 502/.test(msg)) throw err;
        console.log(`  plot retry in 15s (${msg.slice(0, 140)})`);
        await new Promise((r) => setTimeout(r, 15_000));
      }
    }
    const { plan } = planRes;
    console.log(`  plot: "${plan.title}", ${plan.shots.length} shots`);

    // THE MOVIE GRADE IS THE IN-HOUSE ENGINE (owner directive, 2026-08-13):
    // the owned stack this worker already runs — depth parallax, rigged
    // speaking characters, phoneme lip-sync, dialogue voices, the film look —
    // priced on THIS runner's minutes. The rented clip stage below survives
    // as an owner-only experiment, OFF unless STORY_MOVIE=on is set
    // explicitly: a ₹57 movie sale must never trigger hundreds of rupees of
    // rented generation, and the tier's cost model says runner compute, not
    // video-model seconds.
    const movie = job.grade === 'movie' && process.env.STORY_MOVIE === 'on';
    // RUNG 1 — the movie grade's own switch, distinct from the rented
    // experiment above: every movie job gets the extra in-house work (today:
    // the mid depth plane), whether or not the clip experiment is on. This is
    // what the tier's price buys that classic never renders.
    const cinematic = job.grade === 'movie';
    if (job.grade === 'movie') {
      console.log(movie
        ? '  movie grade: RENTED clip experiment on (STORY_MOVIE=on)'
        : '  movie grade: in-house engine');
    }

    // One voice for the whole film. A narrator that changes between shots is
    // the audio version of the character drift the cast locks exist to fix.
    const voice = process.env.STORY_VOICE ?? 'Charon';

    // Which engine speaks. 'cloud' is Gemini, the primary; 'local' is Piper
    // on this runner's own CPU. STORY_LOCAL_TTS=only starts the film fully
    // in-house (the owner's quota-free switch); otherwise the engine flips
    // to local exactly once, mid-film, if the cloud bucket dies — and stays
    // there so voices do not flip-flop between shots.
    let ttsEngine = process.env.STORY_LOCAL_TTS === 'only' ? 'local' : 'cloud';

    // DIALOGUE VOICES. A shot may carry a spoken line (plan.shots[i].dialogue,
    // written by story-plot's movie grammar). It is voiced with a DIFFERENT
    // Gemini voice from the narrator and appended after the shot's narration —
    // narrator sets the scene, the character speaks, which is the oldest cut
    // in film. The voice is chosen by hashing the speaker's name, so the same
    // character keeps the same voice for the whole film — the audio version of
    // the cast lock — and the narrator's voice is excluded from the pool so a
    // character can never be mistaken for the storyteller.
    const CHARACTER_VOICES = ['Puck', 'Kore', 'Fenrir', 'Aoede', 'Orus', 'Leda'];
    const voiceFor = (speaker) => {
      let h = 0;
      for (const ch of String(speaker).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const pool = CHARACTER_VOICES.filter((v) => v !== voice);
      return pool[h % pool.length];
    };
    const ffmpeg = findBin('ffmpeg');

    // RUNG 4 — the eyeline pass, decided over the WHOLE plan before any shot
    // renders: in a run of rigged shots where two characters trade coverage,
    // they face each other across the cuts (the 180-degree rule). Per-shot
    // grammar cannot see a conversation; only a pass over the sequence can,
    // which is why this sits outside the loop.
    const shotRigs = plan.shots.map((s) => rigFor(plan, s));
    const facings = conversationFacings(shotRigs.map((rig) => ({ rig })));

    const rendered = [];
    // Rung 11: the shots' emotional registers, collected for the film-level
    // score vote. Classic films push nulls and vote for silence.
    const shotEmotions = [];
    let movingShots = 0;
    for (const [i, shot] of plan.shots.entries()) {
      // One call per shot, sequentially. Not a fan-out: the rate limit is per
      // call and a loop that ignores it is how a month of credits goes in an
      // hour.
      //
      // A REFUSED FRAME STEPS DOWN A LADDER, NOT STRAIGHT TO FAILURE.
      // Gemini's image filter refuses the odd frame out of a plan that is
      // otherwise fine — the first Aladdin proof film died on shot four of
      // seventeen, the second on shot EIGHT after a reworded retry was
      // refused too, which proved rewording the same content is not a
      // reliable escape. Three asks, each safer by construction:
      //   1. The plan's own frame, verbatim — the normal path.
      //   2. The shot's NARRATION as the scene, cast locks kept, storybook
      //      framing — same content, softer wording.
      //   3. Scenery only: the locked setting with nobody in it. This one is
      //      tame by CONSTRUCTION, not by phrasing — and it is honest,
      //      because the rig puppet is a separate layer that rides above the
      //      plate, so a character still stands in the finished shot.
      // All three refused fails the job as before: inventing content beyond
      // the plan to dodge a filter is the second-planner problem.
      // Every ask is sliced under story-still's 2000-char MAX_PROMPT. Run 67
      // finished SIXTEEN of seventeen shots and then died on this: one
      // verbose still text plus the setting crossed the cap and the 400 was
      // outside the ladder. The slice loses the tail of the setting, which
      // is repeated in every other shot anyway — a marginally vaguer frame
      // beats a dead film, the same trade as the refusal rungs below.
      const locks = (plan.cast ?? []).map((c) => `${c.name}: ${c.lock}`).join('\n');
      const asks = [
        `${shot.still}\n\nSetting: ${plan.setting}`.slice(0, 1900),
        (
          `Gentle, family-friendly animated storybook illustration. ` +
          `${shot.narration}\n\nCharacters:\n${locks}\n\nSetting: ${plan.setting}`
        ).slice(0, 1900),
        `A gentle watercolor storybook illustration of a place with no people in it: ` +
          `${plan.setting}. Soft warm light, wide view.`.slice(0, 1900),
      ];
      let still;
      outer: for (let a = 0; a < asks.length; a++) {
        // NO_IMAGE is an EMPTY reply, not a verdict — run 66 saw it clear on
        // the next identical call while run 69 lost a film to it on the
        // scenery rung, whose content cannot be the problem. One same-ask
        // repeat before it counts as a refusal; a named refusal
        // (PROHIBITED_CONTENT) steps straight down.
        for (let t = 0; t < 2; t++) {
          try {
            still = await edge('story-still', { prompt: asks[a] });
            break outer;
          } catch (err) {
            const msg = String(err?.message ?? err);
            // A refusal or a length rejection both step down; anything else
            // is a real failure and throws.
            const steppable =
              /story-still: 422/.test(msg) || /story-still: 400 .*too long/i.test(msg);
            if (!steppable) throw err;
            if (/NO_IMAGE/.test(msg) && t === 0) {
              console.log(`  still ${i + 1}: empty reply — same ask once more`);
              continue;
            }
            if (a === asks.length - 1) throw err;
            console.log(`  still ${i + 1}: refused (${msg.slice(0, 120)}) — step-down ${a + 2}/3`);
            break;
          }
        }
      }
      const stem = `shot${String(i).padStart(3, '0')}`;
      const stillFile = path.join(assetRoot, `${stem}.png`);
      fs.writeFileSync(stillFile, Buffer.from(still.data, 'base64'));
      console.log(`  still ${i + 1}/${plan.shots.length}`);

      // The camera comes from what the SHOT IS, read off Ting's own size word,
      // not from the shot's position in the film. Only SLIDES advance the
      // alternation: every shot moves now, so counting movement would let a
      // push in the middle flip the direction and send two slides the same way.
      const framing = framingFor(shot.still, movingShots);
      if (isSlide(framing)) movingShots += 1;

      // NARRATION: the cloud voice first, the in-house voice when the cloud
      // cannot answer. A story-voice 502 that survives every paced retry is
      // the daily bucket gone — waiting will not fix it inside this run —
      // and a fourteen-shot film died exactly there with every frame paid
      // for. Piper speaks the line instead, and the ENGINE STAYS SWITCHED
      // for the rest of the film: a narrator changing voice once, at the
      // moment the bucket died, beats one flip-flopping minute to minute.
      // Anything that is not a 502 (a refusal, a missing key) still throws.
      let wav = path.join(assetRoot, `${stem}.wav`);
      if (ttsEngine === 'cloud') {
        try {
          const voiced = await voiceWithRetry({ text: shot.narration, voice }, 4);
          fs.writeFileSync(wav, wrapPcmAsWav(Buffer.from(voiced.data, 'base64'), rateOf(voiced.mime)));
        } catch (err) {
          if (!/story-voice: 502/.test(String(err?.message ?? err))) throw err;
          if (!(await localTts())) throw err;
          ttsEngine = 'local';
          console.log(`  voice ${i + 1}: cloud quota dry — in-house piper carries the film from here`);
        }
      }
      if (ttsEngine === 'local') {
        const tts = await localTts();
        if (!tts) throw new Error('in-house tts unavailable and cloud voice exhausted');
        synthLocal(ffmpeg, tts, shot.narration, wav);
      }

      // The shot's spoken line, if the plan wrote one. Appended AFTER the
      // narration with a 350ms breath, into ONE wav — the measured duration
      // below then includes it automatically, so narration-as-clock, the Ken
      // Burns length and the mouth spans all keep working unchanged. A failure
      // here downgrades the shot to narration-only rather than failing the
      // film: dialogue is seasoning, not structure. Local dialogue draws a
      // stable speaker from the 904-voice cast model by name hash — the same
      // voice-lock idea as voiceFor() on the cloud path.
      // Whether the line was actually VOICED, not merely planned — the
      // rung 4 `speaking` flag keys off this, because a skipped dialogue
      // line leaves narration-only audio and a full-gain oration over it
      // would be a body performing a line nobody hears.
      let dialogueVoiced = false;
      if (shot.dialogue && shot.dialogue.line && shot.dialogue.speaker) {
        try {
          const dwav = path.join(assetRoot, `${stem}.line.wav`);
          let spokenBy = voiceFor(shot.dialogue.speaker);
          if (ttsEngine === 'cloud') {
            try {
              const dv = await voiceWithRetry(
                { text: shot.dialogue.line, voice: spokenBy },
                2,
              );
              fs.writeFileSync(dwav, wrapPcmAsWav(Buffer.from(dv.data, 'base64'), rateOf(dv.mime)));
            } catch (err) {
              if (!/story-voice: 502/.test(String(err?.message ?? err))) throw err;
              if (!(await localTts())) throw err;
              ttsEngine = 'local';
            }
          }
          if (ttsEngine === 'local') {
            const tts = await localTts();
            if (!tts) throw new Error('in-house tts unavailable');
            const speaker = speakerFor(shot.dialogue.speaker, tts.castSpeakers);
            synthLocal(ffmpeg, tts, shot.dialogue.line, dwav, { speaker });
            spokenBy = `piper#${speaker}`;
          }
          const mixed = path.join(assetRoot, `${stem}.mix.wav`);
          execFileSync(ffmpeg, [
            '-y', '-i', wav, '-i', dwav,
            '-filter_complex', '[0:a]apad=pad_dur=0.35[a0];[a0][1:a]concat=n=2:v=0:a=1[a]',
            '-map', '[a]', mixed,
          ], { stdio: 'pipe' });
          wav = mixed;
          dialogueVoiced = true;
          console.log(`  dialogue ${i + 1}: ${shot.dialogue.speaker} (${spokenBy})`);
        } catch (err) {
          console.log(`  dialogue ${i + 1} skipped: ${err?.message ?? err}`);
        }
      }

      // MEASURED, both of them. The duration decides how long the shot is on
      // screen — narration is the clock and a word-count estimate drifts
      // further out of sync with every shot. The spans decide when the mouth
      // moves, and they come from the same envelope the episodes use, imported
      // rather than reimplemented so the two cannot disagree.
      const seconds = secondsOf(wav);
      const durationFrames = Math.max(1, Math.round(seconds * FPS));
      const spans = speechSpans(envelope(ffmpeg, wav)).filter(([a]) => a < durationFrames);

      // RUNG 8 — the sound stage, movie grade only. The shot's own words
      // earn an ambient bed (or nothing), synthesized deterministically
      // from lavfi noise at the measured shot length and mixed UNDER the
      // narration by the composition. Applies to clip shots too: Veo's
      // video is muted always, so the bed is the only air a clip has.
      // A synth failure drops the bed, never the film.
      let ambience = null;
      if (cinematic) {
        const kind = ambienceFor(`${shot.still} ${shot.narration}`);
        if (kind) {
          try {
            const amb = path.join(assetRoot, `${stem}.amb.wav`);
            execFileSync(ffmpeg, [
              '-y', '-f', 'lavfi',
              '-i', ambienceGraph(kind, vfxSeed(`amb:${i}:${shot.still}`)),
              '-t', String(seconds), '-ar', '44100', '-ac', '1', amb,
            ], { stdio: 'pipe' });
            ambience = { src: `${assetDir}/${path.basename(amb)}`, kind };
            console.log(`  air ${i + 1}: ${kind}`);
          } catch (err) {
            console.log(`  air ${i + 1}: synth failed (${String(err?.message ?? err).slice(0, 80)}) — silent`);
          }
        }
      }

      // THE CLIP — movie grade only, and the reason the grade exists. Runs
      // AFTER the audio so the ask can match the measured shot length. Every
      // failure steps the shot down to the classic stills path rather than
      // failing the film: a Ken Burns shot inside a movie film is a shot,
      // not a hole, and the ep3 finding is that refusals are luck, not
      // verdicts. Sequential like every billable call here.
      let clip = null;
      if (movie) {
        try {
          const got = await generateClip(shot, stillFile, seconds);
          const clipFile = path.join(assetRoot, `${stem}.clip.mp4`);
          fs.writeFileSync(clipFile, Buffer.from(got.data, 'base64'));
          const clipSeconds = secondsOf(clipFile);
          // Two frames shy of the measured end: the composition must never
          // seek past the last decodable frame, and the Freeze tail holds
          // whichever frame the live part ends on.
          const clipFrames = Math.max(1, Math.floor(clipSeconds * FPS) - 2);
          clip = { src: `${assetDir}/${stem}.clip.mp4`, frames: clipFrames };
          console.log(
            `  clip ${i + 1}/${plan.shots.length}: ${clipSeconds.toFixed(1)}s of motion` +
              (clipFrames < durationFrames ? ` (freeze tail ${durationFrames - clipFrames}f)` : ''),
          );
        } catch (err) {
          console.log(
            `  clip ${i + 1}: still carries the shot (${String(err?.message ?? err).slice(0, 140)})`,
          );
        }
      }

      // RUNG 0.5 — the 2.5D near plane, for shots the clip stage did not
      // cover. Depth once per shot (~2s of CPU), alpha-cut the near content,
      // and let the composition slide it faster than the base. Every failure
      // and both coverage gates step the shot down to plain Ken Burns; the
      // film never waits on this stage's mood. A shot with a real clip skips
      // it entirely — measured motion beats simulated motion.
      let nearPlane = null;
      let midPlane = null;
      if (!clip) {
        try {
          const model = await depthModel();
          if (model) {
            const depth01 = normalizeDepth(await inferDepth(model, stillFile));
            const alpha = nearPlaneAlpha(depth01, PARALLAX.threshold);
            const coverage = planeCoverage(alpha);
            const out = await cutNearPlane(
              stillFile,
              path.join(assetRoot, `${stem}.near.png`),
              alpha,
              coverage,
              PARALLAX,
            );
            if (out) {
              nearPlane = `${assetDir}/${stem}.near.png`;
              console.log(`  depth ${i + 1}: near plane ${(coverage * 100).toFixed(0)}%`);
            } else {
              console.log(`  depth ${i + 1}: flat (coverage ${(coverage * 100).toFixed(0)}%) — plain Ken Burns`);
            }
            // RUNG 1 — the mid band, movie grade only. Same depth map, same
            // cutter, same honesty gates; only the band differs. Cut even
            // when the near plane gated out: a landscape with no foreground
            // can still carry a moving mid field.
            if (cinematic) {
              const midMask = bandAlpha(depth01, PARALLAX.midThreshold, PARALLAX.threshold);
              const midCoverage = planeCoverage(midMask);
              const midOut = await cutNearPlane(
                stillFile,
                path.join(assetRoot, `${stem}.mid.png`),
                midMask,
                midCoverage,
                PARALLAX,
              );
              if (midOut) {
                midPlane = `${assetDir}/${stem}.mid.png`;
                console.log(`  depth ${i + 1}: mid plane ${(midCoverage * 100).toFixed(0)}%`);
              }
            }
          }
        } catch (err) {
          console.log(`  depth ${i + 1}: skipped (${err?.message ?? err})`);
        }
      }

      // A LISTENED mouth, where a rig will actually draw one. Rhubarb's phone
      // recognizer replaces the spelled-caption guess with the shapes the
      // audio really makes — its alphabet IS the rig's Viseme set. Run only
      // when the shot has a character (CPU is the render budget), and treat
      // any failure exactly like a failed dialogue line: log, step down to
      // the text heuristic, keep the film.
      // Shipped RAW, in seconds: the frames conversion (cuesFromRhubarb)
      // lives in visemes.ts, which only the composition can import — its
      // internal extensionless imports defeat Node's type-stripping, and a
      // second JS copy here is exactly the drift the repo keeps refusing.
      let heardCues = null;
      if (!clip && rigFor(plan, shot)) {
        try {
          const heard = await rhubarbCuesForWav(
            ffmpeg,
            wav,
            `${shot.narration} ${shot.dialogue?.line ?? ''}`.trim(),
          );
          if (heard.length > 0) heardCues = heard;
          console.log(`  mouth ${i + 1}: rhubarb heard ${heard.length} cues`);
        } catch (err) {
          console.log(`  mouth ${i + 1}: rhubarb skipped (${err?.message ?? err})`);
        }
      }

      // RUNG 3 — the particle atmosphere, movie grade only. The shot's own
      // words choose the effect (or nothing — absence is the honest default),
      // and the seed is hashed from the shot's identity so every render of
      // this plan draws the same air. Skipped over clips: Veo scenes carry
      // their own atmosphere and a second one on top would disagree.
      let vfx = null;
      if (cinematic && !clip) {
        const kind = vfxKindFor(`${shot.still} ${shot.narration}`);
        if (kind) {
          vfx = { kind, seed: vfxSeed(`${i}:${shot.still}`) };
          console.log(`  vfx ${i + 1}: ${kind}`);
        }
      }

      // RUNG 4 — the body language, movie grade only. Facing comes from the
      // plan-wide eyeline pass above; the gait from the shot's own words
      // (the vfxKindFor honesty gate, applied to feet); `speaking` marks a
      // character delivering THEIR line rather than standing under
      // narration. Classic films get no performance object at all, which is
      // what keeps them pixel-identical to the rung-2 look.
      let performance = null;
      // RUNG 5 — the emotional register, movie grade only. The shot's own
      // words (narration, the still prompt, and the spoken line — feeling
      // often lives in the dialogue) pick a drawn face, or nothing. The
      // worker only names the emotion; WHICH characters own a bust for it
      // is the composition's data, so an unmeasured character silently
      // keeps the painted base head.
      let expression = null;
      // RUNG 6 — the two-shot, movie grade only. When the shot's words put
      // a SECOND rigged cast member in the frame and the framing is full
      // or wider, the conversation shares one frame instead of cutting
      // between singles: primary and companion on opposite thirds, facing
      // each other, the mouth cues riding whoever the dialogue names.
      let companion = null;
      if (cinematic && !clip && shotRigs[i]) {
        // The cast names are the WALKERS walkFor accepts — a gait verb with
        // no named subject is scenery, and the still prompt is full of
        // roads that run and suns that climb.
        const castNames = (plan.cast ?? []).map((m) => String(m.name ?? ''));
        const walk = walkFor(`${shot.still} ${shot.narration}`, castNames);
        expression = emotionFor(
          `${shot.still} ${shot.narration} ${shot.dialogue?.line ?? ''}`,
        );
        // Rung 6: a second rigged face in this shot's own words, at a
        // framing wide enough to hold two figures. The mention scan mirrors
        // rigFor's matching exactly — same normalisation, same substring
        // rule — so primary and companion cannot disagree at the margins.
        const castRigs = (plan.cast ?? []).map((m) => {
          const name = String(m.name ?? '');
          return {
            name,
            rig:
              RIG_KEY_BY_NAME.get(
                name.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, ''),
              ) ?? null,
          };
        });
        const other = riggedMentions(`${shot.still} ${shot.narration}`, castRigs).find(
          (rig) => rig !== shotRigs[i],
        );
        const twoShot = Boolean(other) && framing.figureHeight <= TWO_SHOT_MAX_FIGURE_HEIGHT;
        // In a two-shot nobody plays to camera: a conversation grammar
        // facing wins when it exists, otherwise the primary takes the left
        // third looking right — stable, since who is primary is stable.
        const primaryFacing = facings[i] ?? (twoShot ? 'right' : null);
        const primarySpeaks =
          dialogueVoiced && speakerMatchesRig(shot.dialogue.speaker, shotRigs[i]);
        const compSpeaks =
          twoShot && dialogueVoiced && speakerMatchesRig(shot.dialogue.speaker, other);
        performance = {
          seed: vfxSeed(`perf:${i}:${shot.still}`),
          ...(primaryFacing
            ? { facing: primaryFacing, center: centerForFacing(primaryFacing) }
            : {}),
          ...(walk ? { walk } : {}),
          ...(primarySpeaks ? { speaking: true } : {}),
          // Rung 10: when the line belongs to the companion, the primary
          // LISTENS — nods on the beats instead of orating along.
          ...(compSpeaks ? { listening: true } : {}),
        };
        if (twoShot) {
          const compFacing = oppositeFacing(primaryFacing);
          companion = {
            rig: other,
            ...(compSpeaks ? { speaks: true } : {}),
            ...(expression ? { expression } : {}),
            performance: {
              seed: vfxSeed(`comp:${i}:${shot.still}`),
              facing: compFacing,
              center: centerForFacing(compFacing),
              ...(compSpeaks ? { speaking: true } : {}),
              // Rung 10, mirrored: the companion listens to the primary.
              ...(primarySpeaks ? { listening: true } : {}),
            },
          };
        }
        const notes = [
          facings[i] ? `faces ${facings[i]}` : twoShot ? 'two-shot left' : 'to camera',
          walk ?? 'standing',
          performance.speaking ? 'speaking' : 'narrated',
          expression ?? 'base face',
          ...(companion
            ? [`with ${companion.rig}${companion.speaks ? ' (speaking)' : ''}`]
            : []),
        ];
        console.log(`  body ${i + 1}: ${notes.join(', ')}`);
      }
      shotEmotions.push(expression);

      rendered.push({
        // Relative to public/, because that is what staticFile() takes. Posix
        // separators explicitly: this is a URL path once it reaches the
        // browser, not a filesystem path.
        still: `${assetDir}/${stem}.png`,
        // path.basename, not `${stem}.wav`: when the shot carries dialogue the
        // playable file is the CONCATENATED one — pointing the composition at
        // the narration-only wav would desync the clock and drop the line.
        audio: `${assetDir}/${path.basename(wav)}`,
        seconds,
        // Camera per shot rather than a house constant: measured across six ep3
        // clips it ran 0.0 to 19.2 percent, half of them locked off.
        travel: framing.travel,
        pan: framing.pan,
        figureHeight: framing.figureHeight,
        // Rung 8's air — movie grade only, absent for wordless-quiet scenes.
        ...(ambience ? { ambience } : {}),
        ...(nearPlane || midPlane
          ? {
              parallax: {
                ...(nearPlane ? { near: nearPlane } : {}),
                ...(midPlane ? { mid: midPlane } : {}),
              },
            }
          : {}),
        ...(vfx ? { vfx } : {}),
        // Real motion, when the clip stage delivered it. The composition
        // plays this INSTEAD of the Ken Burns/parallax/rig stack — Veo
        // animated the character in the frame, so a puppet on top would be a
        // second, disagreeing performance.
        ...(clip ? { clip } : {}),
        // A character only where the plan says someone is on screen AND that
        // someone has a measured rig. An unmeasured character would need a
        // guessed mouth anchor, which looks like it works until the mouth opens
        // near the chin.
        ...(!clip && shotRigs[i]
          ? {
              character: {
                rig: shotRigs[i],
                text: shot.narration,
                speech: spans,
                // Present only when Rhubarb succeeded; the composition
                // prefers it and falls back to text+spans when absent.
                ...(heardCues ? { heard: heardCues } : {}),
                // Rung 4's body language — movie grade only, see above.
                ...(performance ? { performance } : {}),
                // Rung 5's drawn face — movie grade only, resolved against
                // the measured busts by the composition.
                ...(expression ? { expression } : {}),
              },
              // Rung 6's second figure — movie grade only. The shot's
              // measured speech spans ride along so a speaking companion
              // gestures on the same beats the primary would have.
              ...(companion ? { companion: { ...companion, speech: spans } } : {}),
            }
          : {}),
      });
      console.log(`  voice ${i + 1}/${plan.shots.length} — ${seconds.toFixed(2)}s, ${spans.length} spans`);
    }

    // RUNG 11 — the score, movie grade only. The film's shots vote on a
    // register (rung 5's emotions; surprise ballots discarded, silence
    // wins when nothing was earned) and one modal drone holds under the
    // whole film — no melody, no rhythm, an octave below the narrator and
    // quieter than the beds. A synth failure drops the score, not the film.
    let score = null;
    if (job.grade === 'movie') {
      const register = scoreFor(shotEmotions);
      if (register) {
        try {
          const scoreWav = path.join(assetRoot, 'score.wav');
          const totalSeconds = rendered.reduce((a, s) => a + s.seconds, 0);
          execFileSync(ffmpeg, [
            '-y', '-f', 'lavfi',
            '-i', scoreGraph(register, vfxSeed(`score:${plan.title}`)),
            '-t', String(totalSeconds), '-ar', '44100', '-ac', '1', scoreWav,
          ], { stdio: 'pipe' });
          score = { src: `${assetDir}/score.wav`, kind: register };
          console.log(`  score: ${register} drone, ${totalSeconds.toFixed(1)}s`);
        } catch (err) {
          console.log(`  score: synth failed (${String(err?.message ?? err).slice(0, 80)}) — silent`);
        }
      } else {
        console.log('  score: no register earned — silent');
      }
    }

    await markAssembling(job);
    const outFile = path.join(work, 'story.mp4');
    // The ONIQ mark is burned in unless the job PAID it off (no_watermark).
    // Passing the flag explicitly rather than omitting it keeps the intent
    // readable here; the composition defaults ON either way.
    await renderPlan(
      {
        title: plan.title,
        shots: rendered,
        watermark: !job.noWatermark,
        // Rung 9: movie films open on their title and close to black.
        grade: job.grade === 'movie' ? 'movie' : 'classic',
        // Rung 11: the film-level drone, when the shots earned one.
        ...(score ? { score } : {}),
      },
      outFile,
    );
    gradeInPlace(outFile);

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

// EXIT EXPLICITLY, with whatever code the run earned. A failed browser launch
// leaves live handles behind — the bundler's esbuild service, Chromium's
// crashpad — and node dutifully waits on them: run 73 marked its job failed
// at 08:36 and then sat as a wedged runner until it was cancelled by hand.
// Everything that matters is awaited by this line; anything still holding the
// event loop open is debris.
process.exit(process.exitCode ?? 0);

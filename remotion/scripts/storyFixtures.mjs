// DRY RUN — the Story pipeline with the money and the database taken out.
//
// WHY THIS EXISTS. Until now there was no way to test this engine without
// paying for it. The still step-down ladder, the voice quota fallback to
// Piper, the clip refusal retry, the assembly and the render could only be
// exercised by starting a real job and buying real stills, real clips and
// real narration — which is how runs 65, 66, 67, 69 and 73 each taught us
// something at full price.
//
// WHAT IT INTERCEPTS, and why the list is longer than it first looks. A first
// version of this file stubbed only the three billable calls and claimed to be
// safe. An adversarial read found that claim was FALSE in three ways, all
// confirmed in the code:
//
//   1. It left `claimJob()` alone. With a service key in the environment, a
//      dry run would claim a REAL QUEUED ROW out of production, fill a paying
//      user's film with synthetic PNGs and sine tones, upload it and mark it
//      ready. Meanwhile the mode its own comment named as the safe one
//      (`PLAN=`) takes an entirely different branch that never reaches the
//      interceptor — so the only way to exercise fixtures was the one way that
//      could damage a real film.
//   2. It left `story-plot` alone, which is a paid LLM call reached through
//      the same edge() helper. "No billable call will be made" was untrue on
//      the very first thing the worker does.
//   3. Its clip fixture returned the wrong key. The worker reads `got.data`;
//      the fixture returned `{video}` or `{refused:true}`, so the happy path
//      was dead code and the "step-down" it advertised was really a TypeError
//      being swallowed by a catch-all — testing the wrong branch entirely.
//
// So the seam now covers the whole network surface, and the mode REFUSES TO
// START if any production credential is present. A dry run needs no key, no
// token and no database, and if one is in the environment that is a mistake
// worth stopping for rather than working around.
//
// Not a recording of anyone's film. Assets are synthetic — procedurally drawn
// PNGs and generated tones. A captured fixture would be a real user's still
// and a real user's narrated voice, and the Story lifecycle promises every
// path ends in `purged`; a fixtures/ directory somebody later commits is the
// one place that guarantee would quietly not hold.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

/**
 * Refuse to run against anything real.
 *
 * This is the guard the first version got backwards, so it is stated as a
 * rule rather than a condition: a dry run has NO credentials. Not "ignores
 * them" — has none. Anything that could authenticate against production is a
 * hard stop, because the failure mode is a user's paid film filled with test
 * data and marked ready.
 */
export function assertNoProductionCredentials(env) {
  const armed = ['SUPABASE_SERVICE_ROLE_KEY', 'STORY_JOB_TOKEN'].filter((k) => env[k]);
  if (armed.length > 0) {
    throw new Error(
      `STORY_FIXTURES is set and so is ${armed.join(' and ')}. A dry run must not be able ` +
        'to reach production at all — it claims no job, writes no row and uploads nothing. ' +
        'Unset the credential, or unset STORY_FIXTURES.',
    );
  }
}

/**
 * A scenario is a JSON file describing the job, the plan, and how each
 * generation call answers, in order.
 *
 * {
 *   "name": "...",
 *   "job":  { "id": "dry-1", "prompt": "...", "shotCount": 3, "grade": "classic" },
 *   "plan": { "title": "...", "setting": "...", "shots": [...] },
 *   "still": [{ "fail": { "status": 422, "error": "PROHIBITED_CONTENT" } }],
 *   "voice": [{ "mime": "audio/wav" }],
 *   "clip":  [{ "polls": 2 }]
 * }
 *
 * An entry list SHORTER than the number of calls repeats its LAST entry, so a
 * fourteen-shot film needs one line, not fourteen. An empty or missing list
 * means "always succeed". Selection is BY CALL ORDINAL, not by content — a
 * retry of the same shot consumes the next entry, which is exactly what makes
 * a ladder scriptable.
 */
export function loadScenario(dir) {
  const file = path.join(dir, 'scenario.json');
  if (!fs.existsSync(file)) throw new Error(`STORY_FIXTURES=${dir} has no scenario.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['still', 'voice', 'clip']) {
    if (raw[k] != null && !Array.isArray(raw[k])) {
      throw new Error(`scenario.json: "${k}" must be an array`);
    }
  }
  if (!raw.job || typeof raw.job !== 'object') {
    throw new Error('scenario.json: "job" is required — the dry run claims nothing from a database');
  }
  if (!raw.plan || !Array.isArray(raw.plan.shots) || raw.plan.shots.length === 0) {
    throw new Error('scenario.json: "plan.shots" is required — story-plot is a paid call and is not made');
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : path.basename(dir),
    job: {
      id: raw.job.id ?? 'dry-run',
      prompt: raw.job.prompt ?? 'a dry run',
      requestedSeconds: raw.job.requestedSeconds ?? 60,
      shotCount: raw.job.shotCount ?? raw.plan.shots.length,
      castJson: raw.job.castJson ?? null,
      noWatermark: raw.job.noWatermark === true,
      grade: raw.job.grade === 'movie' ? 'movie' : 'classic',
      verbatim: raw.job.verbatim === true,
    },
    plan: raw.plan,
    stillPx: raw.stillPx ?? { w: 540, h: 960 },
    still: raw.still ?? [],
    voice: raw.voice ?? [],
    clip: raw.clip ?? [],
  };
}

/** The nth entry, with the last one repeating forever. */
function entryAt(list, n) {
  if (!list || list.length === 0) return {};
  return list[Math.min(n, list.length - 1)];
}

/**
 * A real, decodable PNG, drawn here rather than shipped as a binary blob.
 *
 * DEFAULT 540x960, not the 64x114 the first version used. A 64px frame is not
 * the production render: depth/parallax and the film look behave differently
 * on a thumbnail, and keeping Remotion real was the whole point of the seam
 * being where it is. Overridable per scenario via `stillPx` when a run wants
 * speed over fidelity.
 */
function syntheticPng(seed, w, h) {
  const hue = (seed * 47) % 256;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    row[0] = 0; // filter: none
    const band = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2;
    for (let x = 0; x < w; x++) {
      const o = 1 + x * 3;
      row[o] = (hue + band * 40) % 256;
      row[o + 1] = (hue * 2 + band * 25 + ((x * 255) / w)) % 256;
      row[o + 2] = (hue * 3 + band * 70) % 256;
    }
    rows.push(row);
  }
  const raw = zlib.deflateSync(Buffer.concat(rows));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', raw),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** Signed 16-bit LE mono PCM. A quiet decaying tone, not silence — silence is
 *  indistinguishable from a zero-length file when something has gone wrong. */
function syntheticPcm(seconds, rate) {
  const n = Math.max(1, Math.round(seconds * rate));
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 180 * t) * 6000 * Math.exp(-t * 0.6)), i * 2);
  }
  return buf;
}

function wavOf(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Seconds of narration for a line, at a measured speaking pace. The worker
 * ffprobes every wav and clocks the film off it, so a fixture that always
 * returned one second would make every dry-run film the same length and hide
 * any duration bug.
 */
function speechSeconds(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.8, (words / 165) * 60);
}

/**
 * A tiny but REAL mp4, for the clip happy path.
 *
 * Built with the ffmpeg the worker already depends on rather than hand-rolled:
 * a synthetic h264 stream written by hand would be subtly wrong and would test
 * ffmpeg's error handling instead of the worker's clip path. Cached per
 * duration so a fourteen-shot film shells out once.
 *
 * NO FILTERS, and that is the whole design of this function. The first version
 * built the clip with `-f lavfi -i color=...`, which is a filter SOURCE, and
 * the ffmpeg the worker finds is Remotion's compositor build — a cut-down
 * binary with libx264 and the mp4 muxer but almost no filters (findFfmpeg.mjs
 * documents the list). So every clip poll threw, the worker's step-down caught
 * it, and each shot quietly "fell back" to its still while the run printed a
 * finished film and a ledger of successful clip calls. A clip fixture that can
 * never answer is worse than none: it reads as coverage.
 *
 * Looping one PNG through the image2 demuxer needs no filter at all, and the
 * PNG is the same procedural frame the still fixture serves.
 */
const clipCache = new Map();
function syntheticMp4(ffmpeg, seconds, w, h) {
  const key = `${seconds}x${w}x${h}`;
  if (clipCache.has(key)) return clipCache.get(key);
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'oniq-fx-'));
  const frame = path.join(dir, 'f.png');
  const out = path.join(dir, 'c.mp4');
  fs.writeFileSync(frame, syntheticPng(7, w, h));
  try {
    execFileSync(ffmpeg, [
      '-v', 'error', '-y',
      '-loop', '1', '-framerate', '30', '-i', frame,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-t', String(seconds), out,
    ]);
  } catch (err) {
    // Named as a FIXTURE failure, without a `story-clip: <status>` prefix, so
    // it can never be mistaken for a provider refusal — neither by a reader
    // nor by the worker's ladders, which match on that shape.
    throw new Error(`fixture could not build a clip mp4 with ${ffmpeg}: ${err?.message ?? err}`);
  }
  const bytes = fs.readFileSync(out);
  clipCache.set(key, bytes);
  return bytes;
}

/**
 * The interceptor.
 *
 * Returns `null` for anything it does not handle, and the caller treats that
 * as "not ours". Every network-shaped call the worker makes is handled here,
 * so a null return in a dry run means a code path was added that this file
 * does not know about — which the worker turns into a loud failure rather
 * than a silent request to a URL that is not there.
 */
export function createFixtureEdge(dir, opts = {}) {
  const scenario = loadScenario(dir);
  const ffmpeg = opts.ffmpeg;
  const counts = { still: 0, voice: 0, clip: 0, plot: 0 };
  const operations = new Map();
  const events = [];

  /**
   * An error shaped EXACTLY as edge() composes one.
   *
   * Load-bearing. Every ladder in the worker string-matches a status number
   * that exists only because edge() interpolates `res.status` into the
   * message. A fixture that returned 200-with-{error} would produce
   * "story-voice: upstream 429", match /story-voice: 502/ never, and silently
   * skip the branch it was written to exercise.
   */
  function refuse(fn, spec) {
    const status = spec.status ?? 502;
    const detail = spec.error ?? 'fixture failure';
    return new Error(`${fn}: ${status} ${JSON.stringify({ error: detail })}`);
  }

  async function handle(fn, body) {
    if (fn === 'story-plot') {
      // A paid LLM call. The scenario supplies the plan outright, which also
      // makes a dry run deterministic — the same fixtures always produce the
      // same film, so a diff in the output is a code change, not the weather.
      counts.plot += 1;
      events.push({ fn: 'story-plot', n: counts.plot });
      return { plan: scenario.plan };
    }

    if (fn === 'story-still') {
      const spec = entryAt(scenario.still, counts.still);
      counts.still += 1;
      events.push({ fn: 'story-still', n: counts.still, spec });
      if (spec.fail) throw refuse('story-still', spec.fail);
      const { w, h } = scenario.stillPx;
      return { configured: true, mime: 'image/png', data: syntheticPng(counts.still, w, h).toString('base64') };
    }

    if (fn === 'story-voice') {
      const spec = entryAt(scenario.voice, counts.voice);
      counts.voice += 1;
      events.push({ fn: 'story-voice', n: counts.voice, spec });
      if (spec.fail) throw refuse('story-voice', spec.fail);
      const rate = spec.rate ?? 24000;
      const seconds = spec.seconds ?? speechSeconds(body?.text);
      // spec.mime is honoured VERBATIM when given, including a PCM mime with
      // no rate= in it. That case is the film-killer worth being able to
      // inject: rateOf() throws "no sample rate in ..." with no status number,
      // so no ladder catches it and the job dies. The first version silently
      // replaced the mime and could not express it.
      if (spec.mime) {
        const pcm = syntheticPcm(seconds, rate);
        const containered = !/l16|pcm/i.test(spec.mime);
        return {
          configured: true,
          voice: body?.voice ?? 'Charon',
          mime: spec.mime,
          data: (containered ? wavOf(pcm, rate) : pcm).toString('base64'),
        };
      }
      return {
        configured: true,
        voice: body?.voice ?? 'Charon',
        mime: `audio/L16;codec=pcm;rate=${rate}`,
        data: syntheticPcm(seconds, rate).toString('base64'),
      };
    }

    if (fn === 'story-clip') {
      if (body?.action === 'start') {
        const spec = entryAt(scenario.clip, counts.clip);
        counts.clip += 1;
        events.push({ fn: 'story-clip:start', n: counts.clip, spec });
        if (spec.fail) throw refuse('story-clip', spec.fail);
        const name = `models/fixture/operations/${counts.clip}`;
        operations.set(name, { left: spec.polls ?? 0, spec, seconds: body?.seconds ?? 4 });
        return { configured: true, operation: name };
      }
      if (body?.action === 'poll') {
        const op = operations.get(body.operation);
        if (!op) throw refuse('story-clip', { status: 404, error: 'unknown operation' });
        if (op.left > 0) {
          op.left -= 1;
          return { done: false };
        }
        if (op.spec.failOnPoll) throw refuse('story-clip', op.spec.failOnPoll);
        if (!ffmpeg) throw new Error('fixture clip needs ffmpeg — set FFMPEG or use a clip fail spec');
        // `data`, because that is the key the worker reads (story-worker.mjs
        // writes Buffer.from(got.data,'base64')). The first version returned
        // `video`, so the happy path was dead code and the "step-down" was a
        // TypeError being swallowed.
        const { w, h } = scenario.stillPx;
        return {
          done: true,
          mime: 'video/mp4',
          data: syntheticMp4(ffmpeg, op.seconds, w, h).toString('base64'),
        };
      }
      throw refuse('story-clip', { status: 400, error: `unknown action ${body?.action}` });
    }

    return null;
  }

  handle.job = () => scenario.job;
  handle.scenarioName = () => scenario.name;
  /** Printed at the end of a run. Assertions on stdout miss the flips that
   *  log nothing — notably the dialogue-path TTS engine switch. */
  handle.summary = () => ({ scenario: scenario.name, counts: { ...counts }, events });
  return handle;
}

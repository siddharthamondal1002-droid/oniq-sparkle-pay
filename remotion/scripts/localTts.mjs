// In-house TTS for a Story: Piper, running on the runner's own CPU.
//
// WHY THIS EXISTS. 2026-08-12: seven proof runs emptied Gemini TTS's daily
// quota and a fourteen-shot film died at the voice stage with every frame
// already paid for. The dispatcher now refuses to start films the day's
// cloud budget cannot finish — this file is the other half: a voice that
// has no quota at all, because it never leaves the machine.
//
// PIPER, SPECIFICALLY, after measuring it here on 2026-08-13:
//   - MIT end to end: the rhasspy/piper binary and the v0.0.2 voices are
//     both MIT and both ship from GitHub RELEASES, which this container and
//     the CI runner can reach (Hugging Face is not reachable from here, so
//     nothing in this file may depend on it — that rules out kokoro-js,
//     whose model only lives on the HF hub).
//   - Fast enough to be boring: measured 0.29x realtime for the narrator
//     model and 0.31x for the cast model, cold, on this container's CPU. A
//     two-minute film's whole soundtrack costs under a minute of runner.
//   - en-us-libritts-high is ONE file holding 904 speakers, so every
//     character gets a distinct, stable voice the same way the Gemini path
//     hashes a name to a prebuilt voice.
//
// Quality is honestly below Gemini's — this is the fallback that keeps a
// film alive when the cloud bucket is dry, and the owner switch for going
// fully quota-free, not a silent replacement of the primary.
//
// Everything is pinned by sha256 of the release tarballs, same discipline
// as the MiDaS stage: what was measured is what runs, or nothing runs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const RELEASES = 'https://github.com/rhasspy/piper/releases/download';

export const PIPER_ASSETS = {
  piper: {
    url: `${RELEASES}/2023.11.14-2/piper_linux_x86_64.tar.gz`,
    sha256: 'a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992',
  },
  /** The narrator: one consistent storyteller, like Charon on the cloud path. */
  narrator: {
    url: `${RELEASES}/v0.0.2/voice-en-us-ryan-high.tar.gz`,
    sha256: 'de346b054703a190782f49acb9b93c50678a884fede49cfd85429d204802d678',
    model: 'en-us-ryan-high.onnx',
  },
  /** The cast: 904 speakers in one model, selected per character by hash. */
  cast: {
    url: `${RELEASES}/v0.0.2/voice-en-us-libritts-high.tar.gz`,
    sha256: '328e3e9cb573a43a6c5e1aeca386e971232bdb1418a74d4674cf726c973a0ea8',
    model: 'en-us-libritts-high.onnx',
    speakers: 904,
  },
};

/**
 * EVERY LINE LEAVES HERE AT 24 kHz MONO, whatever Piper's native rate is,
 * because the dialogue mix concatenates a shot's narration and spoken line
 * with ffmpeg's concat filter, which requires equal rates — and the other
 * engine (Gemini) answers at 24 kHz. A film can then mix cloud and local
 * lines in one shot without the mix step ever caring who spoke.
 */
export const LOCAL_TTS_RATE = 24000;

function download(url, file) {
  // curl rather than fetch: these are 100-130MB tarballs and curl's retry
  // and redirect handling has already been proven by the model downloads in
  // this repo's other stages.
  //
  // --retry-all-errors IS LOAD-BEARING, and its absence killed a film.
  // Measured 2026-09-11, job 25bd27fd: the piper tarball died on
  // `curl: (35) Recv failure: Connection reset by peer` WITH `--retry 3`
  // already set, because plain --retry covers transient HTTP statuses and
  // a handful of timeouts -- not a connection torn down mid-body. curl
  // retried nothing, the in-house voice was reported unavailable, and a
  // 60-second film failed and was refunded. The same URL answered 200 from
  // a different machine minutes later, and the two runs before it that
  // morning had downloaded it fine, so this was one bad socket and nothing
  // more. --retry-delay spaces the attempts so a blip has time to pass;
  // --connect-timeout stops a black-holed connect from eating the budget.
  execFileSync(
    'curl',
    [
      '-sSL', '--fail',
      '--retry', '5', '--retry-all-errors', '--retry-delay', '2',
      '--connect-timeout', '20',
      '-o', file, url,
    ],
    { stdio: 'pipe', timeout: 10 * 60 * 1000 },
  );
}

function verify(file, sha256) {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest !== sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`local tts asset sha256 mismatch for ${path.basename(file)}: ${digest}`);
  }
}

/**
 * Download (if absent), verify and unpack everything Piper needs.
 * Returns the paths the synth step uses. Throws on any mismatch — the
 * WORKER decides what a missing local voice means for the film.
 */
export function ensureLocalTts(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const [name, asset] of Object.entries(PIPER_ASSETS)) {
    const tarball = path.join(cacheDir, `${name}.tar.gz`);
    const marker = asset.model
      ? path.join(cacheDir, asset.model)
      : path.join(cacheDir, 'piper', 'piper');
    if (fs.existsSync(marker)) continue;
    if (!fs.existsSync(tarball)) download(asset.url, tarball);
    verify(tarball, asset.sha256);
    execFileSync('tar', ['xzf', tarball, '-C', cacheDir], { stdio: 'pipe' });
    if (!fs.existsSync(marker)) {
      throw new Error(`local tts tarball ${name} did not contain ${path.basename(marker)}`);
    }
  }
  return {
    piperBin: path.join(cacheDir, 'piper', 'piper'),
    narratorModel: path.join(cacheDir, PIPER_ASSETS.narrator.model),
    castModel: path.join(cacheDir, PIPER_ASSETS.cast.model),
    castSpeakers: PIPER_ASSETS.cast.speakers,
  };
}

/**
 * A character's speaker id: hashed from the name, so the same character
 * keeps the same voice for the whole film — the audio version of the cast
 * lock, identical in spirit to voiceFor() on the cloud path.
 */
export function speakerFor(name, speakers) {
  let h = 0;
  for (const ch of String(name).toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % speakers;
}

/**
 * Speak one line to a wav at LOCAL_TTS_RATE. `speaker` selects a cast
 * voice from the multi-speaker model; absent means the narrator.
 */
export function synthLocal(ffmpeg, tts, text, outWav, opts = {}) {
  const model = opts.speaker == null ? tts.narratorModel : tts.castModel;
  const raw = `${outWav}.piper.wav`;
  const args = ['--model', model, '--output_file', raw];
  if (opts.speaker != null) args.push('--speaker', String(opts.speaker));
  const run = spawnSync(tts.piperBin, args, {
    input: String(text),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5 * 60 * 1000,
  });
  if (run.status !== 0 || !fs.existsSync(raw)) {
    fs.rmSync(raw, { force: true });
    throw new Error(`piper failed: ${String(run.stderr ?? '').slice(-200)}`);
  }
  try {
    execFileSync(
      ffmpeg,
      ['-y', '-i', raw, '-ar', String(LOCAL_TTS_RATE), '-ac', '1', outWav],
      { stdio: 'pipe' },
    );
  } finally {
    fs.rmSync(raw, { force: true });
  }
  // A wav header alone is 44 bytes; anything near that spoke nothing, and a
  // silent narration would shift the whole film's clock. Fail loudly here.
  if (!fs.existsSync(outWav) || fs.statSync(outWav).size < 4096) {
    throw new Error(`piper produced no usable audio for: ${String(text).slice(0, 60)}`);
  }
  return outWav;
}

/** Default cache location; the workflow may override via STORY_TTS_CACHE. */
export function defaultTtsCache() {
  return process.env.STORY_TTS_CACHE || path.join(os.tmpdir(), 'oniq-piper');
}

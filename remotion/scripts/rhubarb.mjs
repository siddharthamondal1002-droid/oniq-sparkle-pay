// Rhubarb Lip Sync, finally inside the worker.
//
// visemes.ts documents the wall this file tears down: "Rhubarb Lip Sync is the
// right tool and ships as a GitHub release binary, which this environment's
// proxy refuses (403). Not a preference — a wall." The wall was around the
// BINARY. The MIT-licensed WASM port (`rhubarb-lip-sync-wasm` on npm) walks
// through the npm registry, which the proxy allows, and runs the same
// PocketSphinx phone recognizer on plain CPU in Node — measured here at ~5s
// wall for 3s of audio including cold WASM start.
//
// What it buys: the mouth stops MIMING and starts LISTENING. buildMouthCues
// spells the caption into shapes and spreads them across the speech spans —
// convincing at conversational distance, but it matches no particular sound.
// Rhubarb returns which Preston Blair shape the audio actually makes, when —
// and its alphabet (A–H plus X) is byte-for-byte the Viseme type the rig
// already draws. No translation layer, just seconds→frames.
//
// FAILURE IS A STEP-DOWN, NEVER A STOP. Everything here can throw — a wav
// ffmpeg can't read, a WASM init that dies on a stripped runner — and the
// worker treats any of it exactly like a failed dialogue line: log, fall back
// to the text heuristic, keep the film. By the time this runs the audio is
// already paid for.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Mouth cues for one shot's wav, in Rhubarb's own {start, end, value} seconds.
 *
 * `dialogText` is Rhubarb's accuracy hint — it biases the recognizer toward
 * the words we know were spoken. Pass the narration plus any dialogue line.
 */
export async function rhubarbCuesForWav(ffmpeg, wavPath, dialogText) {
  // Rhubarb's WASM wants 16-bit PCM, 16kHz, mono — decode with the same
  // ffmpeg the worker already resolved, straight to a pipe, no temp file.
  const pcm = execFileSync(
    ffmpeg,
    ['-v', 'error', '-i', wavPath, '-ac', '1', '-ar', '16000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'],
    { maxBuffer: 512 * 1024 * 1024 },
  );

  const { Rhubarb } = require('rhubarb-lip-sync-wasm');

  // The package narrates every step — [DEBUG] lines and Emscripten heap
  // notices — across SEVERAL console channels, which would bury the worker's
  // own one-line-per-shot log. Silence all of them for the duration of the
  // call only; a real failure still surfaces as the thrown exception.
  const names = ['log', 'debug', 'info', 'warn', 'error'];
  const saved = Object.fromEntries(names.map((n) => [n, console[n]]));
  for (const n of names) console[n] = () => {};
  try {
    const result = await Rhubarb.getLipSync(pcm, dialogText ? { dialogText } : undefined);
    return result?.mouthCues ?? [];
  } finally {
    for (const n of names) console[n] = saved[n];
  }
}

// Synthesize the promo shots' music beds — original, generated, rights-free.
//
//   node scripts/make-promo-music.mjs   → ../.tmp/promo-music/{pulse,drift}.wav
//
// Written in code rather than sourced, deliberately: a licensed track is a
// takedown waiting to happen across fifty uploads on four platforms, and the
// repo already treats synthesized audio as the normal way to score things
// (the episode underscore, the ambient beds). Two beds, sixteen seconds each,
// longer than the longest shot so the mux only ever trims:
//
//   pulse  124 BPM, A minor — kick, offbeat hats, bass, plucked arp. The
//          upbeat one; features, stats, chat, calls, hook, cta.
//   drift  84 BPM, A minor — slow pad swells and a sparse pluck, no kit.
//          The cinematic one; originals, story, worlds.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.MUSIC_DIR ?? path.resolve(__dirname, '../../.tmp/promo-music');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SR = 44100;
const DUR = 16;
const N = SR * DUR;

/** A-minor pitch table, Hz. */
const HZ = (midi) => 440 * 2 ** ((midi - 69) / 12);
const A2 = 45, C3 = 48, D3 = 50, E3 = 52, G2 = 43;
const PENTA = [69, 72, 74, 76, 79, 81, 84]; // A4 C5 D5 E5 G5 A5 C6

/** Tiny deterministic PRNG so both channels agree and re-runs are identical. */
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const writeWav = (name, left, right) => {
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + N * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(N * 4, 40);
  // Normalise to a healthy but unclipped peak.
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const g = peak > 0 ? 0.85 / peak : 1;
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(left[i] * g * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(right[i] * g * 32767), 46 + i * 4);
  }
  const out = path.join(OUT_DIR, name);
  fs.writeFileSync(out, buf);
  console.log(`${name}: ${DUR}s, ${(buf.length / 1024) | 0}KB`);
};

/* ------------------------------- pulse bed ------------------------------- */
{
  const L = new Float64Array(N);
  const R = new Float64Array(N);
  const BPM = 124;
  const beat = (60 / BPM) * SR;
  const sixteenth = beat / 4;

  // Kick: pitch-dropping sine thump on every beat.
  for (let b = 0; b * beat < N; b++) {
    const start = Math.round(b * beat);
    for (let i = 0; i < SR * 0.16 && start + i < N; i++) {
      const t = i / SR;
      const f = 120 * Math.exp(-t * 26) + 44;
      const env = Math.exp(-t * 22);
      const s = Math.sin(2 * Math.PI * f * t) * env * 0.9;
      L[start + i] += s;
      R[start + i] += s;
    }
  }

  // Hats: filtered-noise ticks on the offbeats.
  for (let b = 0; (b + 0.5) * beat < N; b++) {
    const start = Math.round((b + 0.5) * beat);
    let hp = 0;
    for (let i = 0; i < SR * 0.05 && start + i < N; i++) {
      const n = rand() * 2 - 1;
      hp = 0.72 * hp + n - 0.95 * (i ? 0 : n);
      const env = Math.exp(-(i / SR) * 90);
      L[start + i] += hp * env * 0.16;
      R[start + i] += hp * env * 0.14;
    }
  }

  // Bass: one note per half-bar, A A C G, soft saw via three harmonics.
  const BASSLINE = [A2, A2, C3, G2];
  for (let h = 0; h * beat * 2 < N; h++) {
    const start = Math.round(h * beat * 2);
    const f = HZ(BASSLINE[h % 4]);
    for (let i = 0; i < beat * 2 && start + i < N; i++) {
      const t = i / SR;
      const env = Math.min(1, t * 30) * Math.exp(-t * 1.4);
      const s =
        (Math.sin(2 * Math.PI * f * t) +
          0.45 * Math.sin(2 * Math.PI * f * 2 * t) +
          0.2 * Math.sin(2 * Math.PI * f * 3 * t)) *
        env *
        0.34;
      L[start + i] += s;
      R[start + i] += s;
    }
  }

  // Arp: pentatonic sixteenth-note plucks, ping-ponged for width.
  const PATTERN = [0, 2, 4, 6, 4, 2, 1, 3];
  for (let s16 = 0; s16 * sixteenth < N; s16++) {
    if (s16 % 2 === 1 && rand() < 0.35) continue; // human gaps
    const start = Math.round(s16 * sixteenth);
    const f = HZ(PENTA[PATTERN[s16 % 8]]);
    const pan = s16 % 2 === 0 ? 0.7 : 0.3;
    for (let i = 0; i < SR * 0.22 && start + i < N; i++) {
      const t = i / SR;
      const env = Math.exp(-t * 16);
      const s = Math.sin(2 * Math.PI * f * t + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * env * 0.2;
      L[start + i] += s * pan;
      R[start + i] += s * (1 - pan);
    }
  }

  // Pad: slow Am chord swell underneath everything.
  for (const m of [57, 60, 64]) {
    const f = HZ(m);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const sw = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 8);
      const s = Math.sin(2 * Math.PI * f * t + Math.sin(t * 0.7) * 0.5) * sw * 0.05;
      L[i] += s;
      R[i] += Math.sin(2 * Math.PI * f * t + 0.9) * sw * 0.05;
    }
  }

  writeWav('pulse.wav', L, R);
}

/* ------------------------------- drift bed ------------------------------- */
{
  const L = new Float64Array(N);
  const R = new Float64Array(N);

  // Chord swells: Am → F, four seconds each, detuned pairs per voice.
  const CHORDS = [
    [45, 57, 60, 64],
    [41, 57, 60, 65],
  ];
  for (let c = 0; c * 4 * SR < N; c++) {
    const start = c * 4 * SR;
    for (const m of CHORDS[c % 2]) {
      const f = HZ(m);
      for (let i = 0; i < 4 * SR && start + i < N; i++) {
        const t = i / SR;
        const sw = Math.sin((Math.PI * i) / (4 * SR)) ** 1.5;
        const s =
          (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 1.004 * t)) * sw * 0.045;
        L[start + i] += s;
        R[start + i] += (Math.sin(2 * Math.PI * f * 0.997 * t) + Math.sin(2 * Math.PI * f * t + 1)) * sw * 0.045;
      }
    }
  }

  // Sparse pluck: one pentatonic note every couple of seconds, echoed.
  for (let k = 0; k < 9; k++) {
    const start = Math.round((0.8 + k * 1.8) * SR);
    if (start >= N) break;
    const f = HZ(PENTA[Math.floor(rand() * PENTA.length)]);
    for (const [delay, gain] of [
      [0, 0.16],
      [0.36, 0.08],
      [0.72, 0.04],
    ]) {
      const s0 = start + Math.round(delay * SR);
      for (let i = 0; i < SR * 1.1 && s0 + i < N; i++) {
        const t = i / SR;
        const env = Math.exp(-t * 4);
        const s = Math.sin(2 * Math.PI * f * t) * env * gain;
        L[s0 + i] += s * (delay ? 0.4 : 0.7);
        R[s0 + i] += s * (delay ? 0.7 : 0.4);
      }
    }
  }

  // A very low root drone holding the floor.
  const f = HZ(33); // A1
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const sw = Math.min(1, t * 0.8) * Math.min(1, (DUR - t) * 0.8);
    const s = Math.sin(2 * Math.PI * f * t) * sw * 0.07;
    L[i] += s;
    R[i] += s;
  }

  writeWav('drift.wav', L, R);
}

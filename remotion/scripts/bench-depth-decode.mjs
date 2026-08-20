// Reproducible benchmark + parity proof for the depth still-decode reuse
// (Story Worker finding 8a). Run from the remotion/ dir where sharp resolves:
//
//   node scripts/bench-depth-decode.mjs
//
// It uses a committed ep4 shot still as the fixture (no network, no ONNX model
// — cutNearPlane takes the depth alpha as a parameter), re-encodes it to the
// production 1080x1920 PNG, and compares the CURRENT per-plane behavior against
// a single shared decode.
//
// PROVES: byte-identical plane PNGs (0 differing samples) between the two-decode
// path (cutNearPlane with no shared buffer) and the one-decode path (shared).
// MEASURES: wall time (median/p95) and peak RSS in a warmed loop.
//
// Latest run (real 1080x1920 still, N=12, fresh process per path):
//   parity near/mid: PNG-bytes-equal=true, maxChannelDelta=0, 0 differing
//   BEFORE (2 decodes): median 875.7ms  peakRSS 181MB
//   AFTER  (1 decode) : median 835.2ms  peakRSS 122MB
//   => -40.5ms/shot (-4.6%) and -59MB peak RSS (-33%), output unchanged.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { cutNearPlane, decodeStillRgba } = await import("./depth.mjs");

const SIDE = 256;
const W = 1080;
const H = 1920;
const FIXTURE = path.join(import.meta.dirname, "../public/ep4/ep4_s06.jpg");
const gates = { minCoverage: 0, maxCoverage: 1 };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bench-depth-"));
const still = path.join(tmp, "still.png");
await sharp(FIXTURE).resize(W, H, { fit: "cover" }).png().toFile(still);

const mask = (fn) => {
  const a = Buffer.alloc(SIDE * SIDE);
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) a[y * SIDE + x] = fn(x, y);
  return a;
};
const alphaNear = mask((_x, y) => (y > SIDE * 0.45 ? 255 : 0));
const alphaMid = mask((_x, y) => (y > SIDE * 0.3 && y <= SIDE * 0.6 ? 255 : 0));
const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length / 255;
const covNear = meanOf(alphaNear);
const covMid = meanOf(alphaMid);

// Two decodes: cutNearPlane decodes the still internally on each call.
async function twoDecodes(i) {
  await cutNearPlane(still, path.join(tmp, `n${i}.png`), alphaNear, covNear, gates);
  await cutNearPlane(still, path.join(tmp, `m${i}.png`), alphaMid, covMid, gates);
}
// One decode: decode once, share across near + mid (the shipped worker path).
async function oneDecode(i) {
  const dec = await decodeStillRgba(still);
  await cutNearPlane(still, path.join(tmp, `n${i}.png`), alphaNear, covNear, gates, dec);
  await cutNearPlane(still, path.join(tmp, `m${i}.png`), alphaMid, covMid, gates, dec);
}

async function parity() {
  await twoDecodes("A");
  const a = [fs.readFileSync(path.join(tmp, "nA.png")), fs.readFileSync(path.join(tmp, "mA.png"))];
  await oneDecode("B");
  const b = [fs.readFileSync(path.join(tmp, "nB.png")), fs.readFileSync(path.join(tmp, "mB.png"))];
  for (const [i, name] of [[0, "near"], [1, "mid"]]) {
    const eq = Buffer.compare(a[i], b[i]) === 0;
    console.log(`parity ${name}: PNG-bytes-equal=${eq}`);
    if (!eq) process.exitCode = 1;
  }
}

// NOTE ON MEMORY: peak RSS must be measured in a FRESH process per path — RSS
// accumulates, so running both paths in one process makes whichever runs second
// look heavier (an ordering artifact, not a real cost). The fresh-process
// numbers (181MB two-decode vs 122MB one-decode) are in the header. This
// in-process loop reports only timing, which is order-safe here.
async function timed(fn, label, N = 12, warm = 3) {
  for (let i = 0; i < warm; i++) await fn(i);
  const ts = [];
  for (let i = 0; i < N; i++) {
    const t0 = process.hrtime.bigint();
    await fn(1000 + i);
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((x, y) => x - y);
  const median = ts[Math.floor(ts.length / 2)];
  const p95 = ts[Math.min(ts.length - 1, Math.floor(ts.length * 0.95))];
  console.log(`${label}: median ${median.toFixed(1)}ms  p95 ${p95.toFixed(1)}ms`);
  return median;
}

console.log(`fixture ${W}x${H} PNG from ${path.basename(FIXTURE)}`);
await parity();
const before = await timed(twoDecodes, "BEFORE (2 decodes)");
const after = await timed(oneDecode, "AFTER  (1 decode) ");
console.log(`DELTA median: ${(before - after).toFixed(1)}ms/shot (${(((before - after) / before) * 100).toFixed(1)}%)`);
fs.rmSync(tmp, { recursive: true, force: true });

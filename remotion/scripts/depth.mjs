// Depth planes for a Story shot: still in, near-plane RGBA out. RUNG 0.5.
//
// MiDaS v2.1 SMALL, and specifically NOT the models an agent will find first:
// sniklaus/3d-ken-burns is CC BY-NC, Depth Anything Large and DA3 have
// non-commercial weights — all refused in the 2026-08-12 licence research.
// MiDaS small is MIT end to end and its 66MB ONNX ships from a GitHub
// release, which both this container and the CI runner can reach. Depth
// Anything V2 SMALL (Apache-2.0) is the documented quality upgrade if wanted;
// this stage takes the model file as a parameter precisely so the swap never
// touches the plane math.
//
// WASM RUNTIME, NOT NATIVE, deliberately: onnxruntime-node downloads its
// binaries in a postinstall from a CDN that at least one environment resets
// mid-transfer, and an install-time failure takes the whole worker down.
// onnxruntime-web ships everything inside the npm tarball and runs the same
// graph on CPU — measured here at ~1.9s per still INCLUDING session
// creation, and the session is cached across shots. Once per shot, not per
// frame: the cost per finished minute is a rounding error.
//
// Everything throws; the WORKER decides that a thrown depth stage means
// "this shot ships as plain Ken Burns", the same step-down as every other
// enrichment stage. A film without parallax beats no film.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Pinned release asset. The hash is the licence audit's anchor: what was
 *  reviewed is what runs, or nothing runs. */
export const MIDAS_URL = 'https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx';
export const MIDAS_SHA256 = '2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58';

/** MiDaS v2.1 small takes 256x256 ImageNet-normalised RGB, NCHW. */
const SIDE = 256;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Download (if absent) and verify the model; returns its path. */
export async function ensureDepthModel(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, 'midas-v21-small.onnx');
  if (!fs.existsSync(file)) {
    const res = await fetch(MIDAS_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`depth model fetch: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (digest !== MIDAS_SHA256) {
    fs.rmSync(file, { force: true });
    throw new Error(`depth model sha256 mismatch: ${digest}`);
  }
  return file;
}

let sessionPromise = null;

/** One inference session for the whole run — creation is most of the cost. */
function depthSession(modelFile) {
  if (!sessionPromise) {
    const ort = require('onnxruntime-web');
    // The WASM backend logs loader chatter; keep the worker log readable the
    // same way the Rhubarb wrapper does.
    ort.env.logLevel = 'error';
    sessionPromise = ort.InferenceSession.create(modelFile, {
      executionProviders: ['wasm'],
    });
  }
  return sessionPromise;
}

/**
 * Inverse-depth map for one still, at SIDExSIDE, raw model values.
 * The caller normalises — normalizeDepth in parallaxPlanes.ts owns that.
 */
export async function inferDepth(modelFile, stillPath) {
  const ort = require('onnxruntime-web');
  const sharp = require('sharp');
  const session = await depthSession(modelFile);
  const { data } = await sharp(stillPath)
    .resize(SIDE, SIDE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const chw = new Float32Array(3 * SIDE * SIDE);
  for (let i = 0; i < SIDE * SIDE; i++) {
    for (let c = 0; c < 3; c++) {
      chw[c * SIDE * SIDE + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    }
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, SIDE, SIDE]) };
  const out = await session.run(feeds);
  return Float32Array.from(out[session.outputNames[0]].data);
}

/**
 * Cut the near plane out of a still: same pixels, alpha from the depth map.
 *
 * Returns the coverage (0..1) so the caller can apply the honesty gate —
 * a near plane covering almost nothing or almost everything ships as null
 * and the shot stays plain Ken Burns. Alpha is produced at SIDExSIDE and
 * upscaled by sharp alongside the colour; the feather survives the resize.
 */
/**
 * Decode a still to full-resolution RGBA ONCE, so the near and mid depth planes
 * can share a single decode instead of re-reading and re-decoding the same PNG
 * per plane. Returns the raw RGBA buffer plus its dimensions.
 *
 * Measured (isolated benchmark, real 1080x1920 still, N=12, fresh process):
 * sharing this across near+mid cut ~40ms/shot (4.6%) AND ~59MB peak RSS (-33%)
 * off the depth stage, with BYTE-IDENTICAL plane output (0 differing samples).
 */
export async function decodeStillRgba(stillPath) {
  const sharp = require('sharp');
  const meta = await sharp(stillPath).metadata();
  const rgba = await sharp(stillPath).removeAlpha().ensureAlpha().raw().toBuffer();
  return { rgba, width: meta.width, height: meta.height };
}

export async function cutNearPlane(stillPath, outPath, alpha, coverage, gates, decoded = null) {
  if (coverage < gates.minCoverage || coverage > gates.maxCoverage) return null;
  const sharp = require('sharp');
  // Decode the still once when the caller shares it across planes (near+mid);
  // otherwise decode here so the single-call path behaves exactly as before.
  const still = decoded ?? (await decodeStillRgba(stillPath));
  const w = still.width;
  const h = still.height;
  // extractChannel, because resize silently promotes 1-channel raw input to
  // 3-channel sRGB: without it this buffer came back w*h*3 and the mask loop
  // below read the top THIRD of the interleaved image — the sky, which is
  // far, which zeroed the whole plane. The length assert keeps that class of
  // silent reinterpretation from ever shipping pixels again.
  const alphaResized = await sharp(Buffer.from(alpha), {
    raw: { width: SIDE, height: SIDE, channels: 1 },
  })
    .resize(w, h, { fit: 'fill' })
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (alphaResized.length !== w * h) {
    throw new Error(`mask resize returned ${alphaResized.length} bytes for ${w * h} pixels`);
  }
  // dest-in: output keeps the still's colour and multiplies in the MASK's
  // alpha — the one composite mode whose whole job is "cut this shape out".
  // (joinChannel looked right for this and silently wrote a 3-channel PNG;
  // the verify step below is why that never shipped.)
  const mask = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) mask[i * 4 + 3] = alphaResized[i];
  // TWO invocations, not one chain: sharp applies `composite` at a fixed
  // late stage of its pipeline, so chaining ensureAlpha().composite() runs
  // the composite against the alpha-less original and THEN adds an opaque
  // alpha — hasAlpha true, mask silently gone. Found by measuring the
  // output (alpha mean 255 at 36% coverage), which is why the verify below
  // checks the mean and not just the header.
  await sharp(still.rgba, { raw: { width: w, height: h, channels: 4 } })
    .composite([{ input: mask, raw: { width: w, height: h, channels: 4 }, blend: 'dest-in' }])
    .png()
    .toFile(outPath);
  // Trust nothing that cannot be measured for the price of a stats pass: a
  // cutout whose alpha silently came out solid would render as a full-frame
  // copy riding ABOVE the base at a different speed — the film would visibly
  // tear. The header alone lies (hasAlpha true, mask gone), so compare the
  // written alpha MEAN against the coverage that was requested.
  const stats = await sharp(outPath).stats();
  const writtenCoverage = (stats.channels[3]?.mean ?? 255) / 255;
  if (Math.abs(writtenCoverage - coverage) > 0.15) {
    fs.rmSync(outPath, { force: true });
    throw new Error(
      `near plane alpha wrote ${(writtenCoverage * 100).toFixed(0)}% against ${(coverage * 100).toFixed(0)}% expected`,
    );
  }
  return outPath;
}

// Render the in-house rig proof to mp4 — a still, real narration, and a mouth.
//
//   cd remotion && OUT=/absolute/path/rig.mp4 CONCURRENCY=4 node scripts/render-rig-proof.mjs
//
// RUN IT WITH NODE, NOT BUN, like every other render script here. Under bun the
// episode render dies at frame 0 with "Could not extract frame from
// compositor". This composition uses no OffthreadVideo so it may well survive
// bun — but "may well" is not a reason to keep a second runtime in play for the
// one operation in this repo that takes minutes to fail.
//
// No pre-flight clip check, because there are no clips. That absence is the
// entire point of the rig: the picture is a still and drawn vector shapes, and
// not one frame of it costs a generation.
//
// THROUGHPUT IS THE REAL MEASUREMENT HERE. The episode pipeline renders at
// ~0.15x realtime and the bottleneck is one ffmpeg encoder, not the browser —
// a 4-core box and a 64-core box measured the same. If the rig lands near that
// too, then a 60-second Story is ~7 minutes of runner time and the product
// question is latency rather than cost. This script prints the rate so that
// number comes from a stopwatch instead of an assumption.
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromium } from './findChromium.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.resolve(__dirname, '../../.tmp/rig-proof.mp4');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const started = Date.now();

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, '../src/rigProof.ts'),
  webpackOverride: (c) => c,
});
console.log(`bundled in ${((Date.now() - started) / 1000).toFixed(1)}s`);

const browser = await openBrowser('chrome', {
  browserExecutable: findChromium(),
  chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
  chromeMode: 'chrome-for-testing',
});

const composition = await selectComposition({
  serveUrl: bundled,
  id: 'rig-proof',
  puppeteerInstance: browser,
});

console.log(
  `rig-proof: ${composition.durationInFrames} frames @ ${composition.fps}fps ` +
    `(${(composition.durationInFrames / composition.fps).toFixed(1)}s) -> ${OUT}`,
);

const renderStarted = Date.now();
let lastLogged = 0;

await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: OUT,
  puppeteerInstance: browser,
  // NOT muted. A silent lip-sync proof proves nothing — and shipping a silent
  // render has already happened once on this project, on episode 1.
  muted: false,
  concurrency: CONCURRENCY,
  crf: 28,
  audioBitrate: '128k',
  onProgress: ({ renderedFrames }) => {
    if (renderedFrames - lastLogged < 60) return;
    lastLogged = renderedFrames;
    const elapsed = (Date.now() - renderStarted) / 1000;
    process.stdout.write(
      `  ${renderedFrames}/${composition.durationInFrames} frames, ` +
        `${(renderedFrames / elapsed).toFixed(2)} fps\n`,
    );
  },
});

// `{ silent: true }` is not optional — close() destructures its argument, so a
// bare close() throws AFTER the render has finished and the mp4 is on disk.
// Same call as render-ep2.mjs and render-ep3.mjs.
await browser.close({ silent: true });

const renderSeconds = (Date.now() - renderStarted) / 1000;
const videoSeconds = composition.durationInFrames / composition.fps;
const size = fs.statSync(OUT).size;

console.log('');
console.log(`rendered ${composition.durationInFrames} frames in ${renderSeconds.toFixed(1)}s`);
console.log(`  ${(composition.durationInFrames / renderSeconds).toFixed(2)} fps`);
console.log(`  ${(videoSeconds / renderSeconds).toFixed(3)}x realtime`);
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log('');
console.log(
  `A 60s Story at this rate is ${(60 / (videoSeconds / renderSeconds) / 60).toFixed(1)} minutes of render.`,
);

// Render the 50 promo shots to mp4, one file per shot.
//
//   cd remotion && OUT_DIR=/absolute/path node scripts/render-shots.mjs
//
// NODE, not bun — the ep3 render documented why (compositor frame deaths
// under bun); silent motion graphics never hit that path, but there is no
// reason to gamble a 50-render batch on it.
//
// The bundle is built ONCE and the browser opened ONCE; only renderMedia
// loops. Bundling per shot would multiply the slowest step by fifty.
//
// muted: true is CORRECT here, and only here — these are silent motion
// graphics like the promo, not episodes. Do not reuse this script for
// anything carrying narration; that bug has shipped once already.
//
// SKIP-IF-PRESENT: a shot whose mp4 already exists in OUT_DIR is skipped, so
// a batch that dies at shot 31 resumes from 31, not 1. Delete a file to force
// its re-render.
import { bundle } from '@remotion/bundler';
import { openBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromium } from './findChromium.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.OUT_DIR ?? path.resolve(__dirname, '../../.tmp/promo-shots');
fs.mkdirSync(OUT_DIR, { recursive: true });

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, '../src/shots.ts'),
  webpackOverride: (config) => config,
});

const executable = findChromium();
const browser = await openBrowser('chrome', {
  browserExecutable: executable,
  chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
  chromeMode: 'chrome-for-testing',
});

// The shot list lives in TypeScript; ask the bundle's own manifest instead of
// re-parsing it here. getCompositions enumerates every registered shot.
const { getCompositions } = await import('@remotion/renderer');
const comps = await getCompositions(bundled, { puppeteerInstance: browser });
console.log(`${comps.length} shots registered`);

let done = 0;
let failed = 0;
for (const comp of comps) {
  const out = path.join(OUT_DIR, `oniq-${comp.id}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 10_000) {
    done += 1;
    console.log(`skip ${comp.id} (exists)`);
    continue;
  }
  const started = Date.now();
  try {
    const composition = await selectComposition({
      serveUrl: bundled,
      id: comp.id,
      puppeteerInstance: browser,
    });
    await renderMedia({
      composition,
      serveUrl: bundled,
      codec: 'h264',
      // crf 23 for short branded motion graphics: flat fields and type
      // compress hard, and platforms re-encode whatever they are given.
      crf: 23,
      outputLocation: out,
      puppeteerInstance: browser,
      muted: true,
      concurrency: Number(process.env.CONCURRENCY ?? 2),
    });
    done += 1;
    const kb = Math.round(fs.statSync(out).size / 1024);
    console.log(
      `ok ${comp.id} ${comp.width}x${comp.height} ${comp.durationInFrames}f ${kb}KB ${Math.round(
        (Date.now() - started) / 1000,
      )}s [${done}/${comps.length}]`,
    );
  } catch (e) {
    // One bad shot must not sink the other forty-nine. Log and carry on; the
    // skip-if-present rule makes the retry cheap.
    failed += 1;
    console.error(`FAIL ${comp.id}: ${e instanceof Error ? e.message : e}`);
  }
}

await browser.close({ silent: false });
console.log(`rendered ${done}/${comps.length}, failed ${failed}`);
process.exit(failed > 0 ? 1 : 0);

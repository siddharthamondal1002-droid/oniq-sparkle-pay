// Render ONIQ Originals Episode 1 to mp4, narration included.
//
// Separate from render-remotion.mjs on purpose. That script renders the promo:
// composition 'main', and `muted: true` because the promo has no audio. Reusing
// it here would silently drop the narration — which is exactly the bug this
// episode already shipped once, when the mp3s were generated and never mounted.
//
// ~8,600 frames at 1080x1920 takes a while. Run it in the background and tail
// the log rather than waiting on a foreground command.
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.resolve(__dirname, '../../.tmp/ep1.mp4');

// Resolve Chromium rather than name it. This script hardcoded
// /opt/pw-browsers/chromium/chrome-linux/chrome, and that directory is empty
// on a re-provisioned box — Playwright installs under a VERSIONED sibling
// (chromium-1194), so the unversioned guess is the one that rots. It fails as
// a path error thrown before a single frame renders, which reads like a
// Remotion problem and is not one. Returning undefined lets Remotion find or
// fetch a browser itself.
function findChromium() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => d.startsWith('chromium'))
    .sort()
    .reverse();
  // Binary first, version second. Playwright ships chromium_headless_shell
  // beside chromium and '_' sorts above '-', so searching directories first
  // finds the shell — which chromeMode 'chrome-for-testing' does not drive.
  // Full chrome in ANY version beats a shell in the newest.
  for (const leaf of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
    for (const dir of dirs) {
      const candidate = path.join(root, dir, leaf);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, '../src/episodes.ts'),
  webpackOverride: (c) => c,
});

const browser = await openBrowser('chrome', {
  browserExecutable: findChromium(),
  chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
  chromeMode: 'chrome-for-testing',
});

const composition = await selectComposition({
  serveUrl: bundled,
  id: 'ep1',
  puppeteerInstance: browser,
});

console.log(`ep1: ${composition.durationInFrames} frames @ ${composition.fps}fps -> ${OUT}`);

await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: OUT,
  puppeteerInstance: browser,
  // NOT muted. The whole point of the episode is the narration.
  muted: false,

  // ENCODE SETTINGS, and they are not cosmetic.
  //
  // Remotion's h264 default is visually near-lossless and produced a 330 MB
  // file for 4m47s — 9.2 Mbps, six times the promo's bitrate, for what is
  // twelve still paintings with slow Ken Burns over them.
  //
  // On 4G at 5 Mbps that is an 8.8 minute download for a 4.8 minute video:
  // it cannot stream in real time for most of the audience this app is built
  // for, and three episodes would be a gigabyte.
  //
  // crf 28 brings it to roughly 47 MB. Measured, then checked by eye: native
  // -resolution crops of hair, beard, fabric weave and the sky gradient are
  // indistinguishable from the default at crf 28. Painterly, soft-edged
  // artwork with no text and no hard geometry is the easiest thing there is
  // to compress; the default was simply the wrong tool for it.
  crf: 28,
  // Narration is a single voice. 317 kbps of AAC was the default; 128 is
  // transparent for speech.
  audioCodec: 'aac',
  audioBitrate: '128k',
  concurrency: Number(process.env.CONCURRENCY ?? 2),
  onProgress: ({ renderedFrames, encodedFrames }) => {
    if (renderedFrames % 300 === 0) {
      console.log(`  rendered ${renderedFrames}/${composition.durationInFrames}, encoded ${encodedFrames}`);
    }
  },
});

await browser.close({ silent: true });
console.log('done', OUT);

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
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.resolve(__dirname, '../../.tmp/ep1.mp4');

const bundled = await bundle({
  entryPoint: path.resolve(__dirname, '../src/index.ts'),
  webpackOverride: (c) => c,
});

const browser = await openBrowser('chrome', {
  browserExecutable:
    process.env.PUPPETEER_EXECUTABLE_PATH ?? '/opt/pw-browsers/chromium/chrome-linux/chrome',
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
  concurrency: Number(process.env.CONCURRENCY ?? 2),
  onProgress: ({ renderedFrames, encodedFrames }) => {
    if (renderedFrames % 300 === 0) {
      console.log(`  rendered ${renderedFrames}/${composition.durationInFrames}, encoded ${encodedFrames}`);
    }
  },
});

await browser.close({ silent: true });
console.log('done', OUT);

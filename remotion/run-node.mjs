import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromium } from './scripts/findChromium.mjs';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT;
const bundled = await bundle({ entryPoint: path.resolve(__dirname, 'src/episodes.ts'), webpackOverride: (c) => c });
const browser = await openBrowser('chrome', { browserExecutable: findChromium(), chromiumOptions: { args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] }, chromeMode: 'chrome-for-testing' });
const composition = await selectComposition({ serveUrl: bundled, id: 'ep3', puppeteerInstance: browser });
console.log(`ep3: ${composition.durationInFrames} frames @ ${composition.fps}fps -> ${OUT}`);
await renderMedia({ composition, serveUrl: bundled, codec: 'h264', outputLocation: OUT, puppeteerInstance: browser, muted: false, crf: 28, audioCodec: 'aac', audioBitrate: '128k', concurrency: Number(process.env.CONCURRENCY ?? 2),
  onProgress: ({ renderedFrames, encodedFrames }) => { if (renderedFrames % 300 === 0) console.log(`  rendered ${renderedFrames}/${composition.durationInFrames}, encoded ${encodedFrames}`); } });
await browser.close({ silent: true });
console.log('done', OUT);

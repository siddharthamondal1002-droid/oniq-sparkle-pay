import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill, openBrowser } from '@remotion/renderer';
const b = await bundle({ entryPoint: './src/index.ts', webpackOverride: (c) => c });
const br = await openBrowser('chrome', { browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH ?? '/bin/chromium', chromiumOptions: { args: ['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'] }, chromeMode: 'chrome-for-testing' });
const c = await selectComposition({ serveUrl: b, id: 'ep1', puppeteerInstance: br });
console.log('frames', c.durationInFrames, 'seconds', c.durationInFrames / 30);
for (const f of [10, 700, 3000, 6000, 8500]) {
  await renderStill({ composition: c, serveUrl: b, output: `/tmp/ep1_${f}.png`, frame: f, puppeteerInstance: br });
}
await br.close({ silent: false });

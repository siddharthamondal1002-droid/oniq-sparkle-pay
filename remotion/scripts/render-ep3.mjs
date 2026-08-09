// Render ONIQ Originals Episode 3 to mp4 — generated video plus narration.
//
//   cd remotion && bun install
//   OUT=/absolute/path/ep3.mp4 CONCURRENCY=4 bun scripts/render-ep3.mjs
//
// BUN, unlike render-ep1/ep2 which run under node: the pre-flight below imports
// the TypeScript manifest and shot plan directly, and node has no loader for
// them. Everything else about the three scripts is the same.
//
// A third script rather than a flag on the other two, for the same reason
// render-ep2.mjs is a second one: render-remotion.mjs hardcodes `muted: true`
// because the promo has no audio, and reusing it for an episode silently drops
// the narration. That bug has already shipped once.
//
// What is different about episode 3: the picture is fifty-seven generated video
// clips rather than sixteen stills, so this script REFUSES TO START unless the
// timeline is real and every clip is present. Both checks exist because the
// alternative is discovering the problem forty minutes into a render.
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromium } from './findChromium.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.resolve(__dirname, '../../.tmp/ep3.mp4');
const CLIPS = path.resolve(__dirname, '../public/ep3/clips');
const NARRATION = path.resolve(__dirname, '../public/ep3');

// --- pre-flight ------------------------------------------------------------
//
// The manifest ships with word-count ESTIMATES so the shot list could be
// written and reviewed before the audio existed. Rendering against them would
// produce an episode whose picture drifts further from its voice with every
// scene — the exact failure the measured-durations rule exists to prevent, and
// one that is invisible in any still frame.
const { MEASURED, EP3_SCENES, FPS } = await import('../src/ep3/manifest.ts').catch(() => {
  throw new Error('run this with a runtime that loads TypeScript (bun), or build first');
});
if (!MEASURED) {
  throw new Error(
    'src/ep3/manifest.ts still holds word-count ESTIMATES (MEASURED = false).\n' +
      '  Generate the narration, then:  node scripts/measure-ep3.mjs\n' +
      '  Paste the array in, set MEASURED = true, and re-run.',
  );
}

const { EP3_SHOT_PLAN } = await import('../src/ep3/shots.ts');

const missingAudio = EP3_SCENES.filter((s) => !fs.existsSync(path.join(NARRATION, `${s.id}.mp3`)));
const missingClips = EP3_SHOT_PLAN.filter((s) => !fs.existsSync(path.join(CLIPS, `${s.id}.mp4`)));
// A clip missing LOCALLY but present on the CDN is one command away, not a
// regeneration. The conformed mp4s are gitignored, so a fresh checkout — or a
// sandbox that lost its working files — has every pointer and no video at all,
// which looks alarming and is trivial to fix.
const fetchable = missingClips.filter((s) =>
  fs.existsSync(path.join(CLIPS, `${s.id}.mp4.asset.json`)),
);
if (missingAudio.length > 0 || missingClips.length > 0) {
  throw new Error(
    [
      missingAudio.length > 0 ? `missing narration: ${missingAudio.map((s) => s.id).join(', ')}` : '',
      missingClips.length > 0
        ? `missing ${missingClips.length} clips: ${missingClips.map((s) => s.id).join(', ')}`
        : '',
      fetchable.length > 0
        ? `${fetchable.length} of them are already on the CDN — recover with:\n` +
          `      bun scripts/ingest-ep3-clips.mjs --fetch`
        : '',
      'run scripts/ingest-ep3-clips.mjs --check to see what is wrong with the ones that do exist',
    ]
      .filter(Boolean)
      .join('\n  '),
  );
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
  id: 'ep3',
  puppeteerInstance: browser,
});

console.log(
  `ep3: ${composition.durationInFrames} frames @ ${composition.fps}fps ` +
    `(${(composition.durationInFrames / FPS / 60).toFixed(2)} min), ` +
    `${EP3_SHOT_PLAN.length} clips -> ${OUT}`,
);

await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: OUT,
  puppeteerInstance: browser,
  // NOT muted. The whole point of the episode is the narration.
  muted: false,

  // Same encode settings as episode 2, and for the same reason: Remotion's
  // h264 default gave 330 MB for 4m47s of still paintings, which cannot stream
  // on 4G. crf 28 lands around 1.1 Mbps.
  //
  // One caveat worth knowing for THIS episode: generated video has real motion
  // in it and compresses less kindly than a slow Ken Burns over a painting.
  // Check the output size and a couple of motion-heavy shots (s11c's crane,
  // s10a's smoke) by eye before shipping; crf 26 is the fallback.
  crf: 28,
  audioCodec: 'aac',
  audioBitrate: '128k',
  concurrency: Number(process.env.CONCURRENCY ?? 2),
  onProgress: ({ renderedFrames, encodedFrames }) => {
    if (renderedFrames % 300 === 0) {
      console.log(
        `  rendered ${renderedFrames}/${composition.durationInFrames}, encoded ${encodedFrames}`,
      );
    }
  },
});

await browser.close({ silent: true });
console.log('done', OUT);

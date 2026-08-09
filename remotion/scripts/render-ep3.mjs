// Render ONIQ Originals Episode 3 to mp4 — generated video plus narration.
//
//   cd remotion && bun install
//   OUT=/absolute/path/ep3.mp4 CONCURRENCY=4 node scripts/render-ep3.mjs
//
// RUN IT WITH NODE, NOT BUN. Under bun the render dies at frame 0 with
// "Could not extract frame from compositor" and a 500 from the frame proxy —
// reproducibly, at any concurrency, on clips that probe clean. The same
// composition renders fine under node. Episodes 1 and 2 never hit it because
// stills never call the compositor's frame server; only OffthreadVideo does.
//
// That is awkward, because the pre-flight below needs the TypeScript manifest
// and shot plan and node cannot import those. So the pre-flight asks BUN for
// the data in a subprocess, and the RENDER stays in node. One script, both
// halves in the runtime that can actually do the job.
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
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { findChromium } from './findChromium.mjs';
import { EPISODE, PUBLIC_DIR, CLIPS_DIR } from './episode.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT ?? path.resolve(__dirname, `../../.tmp/${EPISODE}.mp4`);

/**
 * Optional "from-to" frame range, e.g. FRAME_RANGE=0-6107.
 *
 * A full pass is ~12,200 frames and takes long enough that a sandbox which
 * recycles between turns can lose it repeatedly — which is exactly what
 * happened twice here. Rendering in halves and concatenating is the escape
 * hatch: each half fits comfortably inside one turn, and the two join cleanly
 * because both are encoded with identical settings.
 *
 * SPLIT ON A SCENE BOUNDARY. A join mid-shot re-encodes across a GOP and can
 * show; a join where the picture was already cutting cannot.
 */
const RANGE = process.env.FRAME_RANGE
  ? process.env.FRAME_RANGE.split('-').map((n) => Number(n.trim()))
  : null;
if (RANGE && (RANGE.length !== 2 || RANGE.some((n) => !Number.isInteger(n)))) {
  throw new Error(`FRAME_RANGE must look like 0-6107, got "${process.env.FRAME_RANGE}"`);
}
const CLIPS = CLIPS_DIR;
const NARRATION = PUBLIC_DIR;

// --- pre-flight ------------------------------------------------------------
//
// The manifest ships with word-count ESTIMATES so the shot list could be
// written and reviewed before the audio existed. Rendering against them would
// produce an episode whose picture drifts further from its voice with every
// scene — the exact failure the measured-durations rule exists to prevent, and
// one that is invisible in any still frame.
/**
 * The manifest and shot plan, read through bun because node cannot load TS.
 *
 * A subprocess rather than an import so that the render itself stays in node —
 * see the note at the top about bun breaking frame extraction. Prints one line
 * of JSON; anything bun writes before it (install noise, warnings) is ignored
 * by taking the last line.
 */
function preflight() {
  // Exports are named per episode (EP3_SCENES, EP4_SCENES), so pick them by
  // shape. A literal name here is what tied this script to one episode.
  const src =
    `const m = await import('./src/${EPISODE}/manifest.ts');` +
    `const s = await import('./src/${EPISODE}/shots.ts');` +
    "const sc = m[Object.keys(m).find((k) => k.endsWith('_SCENES'))];" +
    "const sh = s[Object.keys(s).find((k) => k.endsWith('_SHOT_PLAN'))];" +
    'console.log(JSON.stringify({ measured: m.MEASURED, fps: m.FPS,' +
    ' scenes: sc.map((x) => x.id), shots: sh.map((x) => x.id) }));';
  let out;
  try {
    out = execFileSync('bun', ['-e', src], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // A THROW HERE IS USUALLY THE GUARD WORKING. src/ep3/shots.ts refuses to
    // load when the shot split does not close, which is exactly what should
    // stop a render.
    throw new Error(
      `pre-flight failed for ${EPISODE}. Either bun is missing, or the shot plan ` +
        `refused to load:\n${err.stderr || err.message}`,
    );
  }
  return JSON.parse(out.trim().split('\n').pop());
}

const { measured: MEASURED, fps: FPS, scenes: SCENE_IDS, shots: SHOT_IDS } = preflight();
if (!MEASURED) {
  throw new Error(
    `src/${EPISODE}/manifest.ts still holds word-count ESTIMATES (MEASURED = false).\n` +
      `  Generate the narration, then:  EPISODE=${EPISODE} node scripts/measure-ep3.mjs\n` +
      '  Paste the array in, set MEASURED = true, and re-run.',
  );
}

const missingAudio = SCENE_IDS.filter((id) => !fs.existsSync(path.join(NARRATION, `${id}.mp3`)));
const missingClips = SHOT_IDS.filter((id) => !fs.existsSync(path.join(CLIPS, `${id}.mp4`)));
// A clip missing LOCALLY but present on the CDN is one command away, not a
// regeneration. The conformed mp4s are gitignored, so a fresh checkout — or a
// sandbox that lost its working files — has every pointer and no video at all,
// which looks alarming and is trivial to fix.
const fetchable = missingClips.filter((id) =>
  fs.existsSync(path.join(CLIPS, `${id}.mp4.asset.json`)),
);
if (missingAudio.length > 0 || missingClips.length > 0) {
  throw new Error(
    [
      missingAudio.length > 0 ? `missing narration: ${missingAudio.join(', ')}` : '',
      missingClips.length > 0
        ? `missing ${missingClips.length} clips: ${missingClips.join(', ')}`
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
  id: EPISODE,
  puppeteerInstance: browser,
});

console.log(
  `${EPISODE}: ${composition.durationInFrames} frames @ ${composition.fps}fps ` +
    `(${(composition.durationInFrames / FPS / 60).toFixed(2)} min), ` +
    `${SHOT_IDS.length} clips${RANGE ? `, frames ${RANGE[0]}-${RANGE[1]}` : ''} -> ${OUT}`,
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
  ...(RANGE ? { frameRange: RANGE } : {}),
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

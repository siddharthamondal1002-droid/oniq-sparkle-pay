// ZERO-COST PROOF that the subject layer moves in-house.
//
// Renders the REAL `story` composition (StoryFilm) with the CAMERA FROZEN
// (travel 0, no pan) so the base/mid/near camera terms are all constant.
// The ONLY thing that can then move the mid/near planes is livingSubjectMotion.
// Each plane carries a bright disc on transparency; we render stills at several
// frames and measure the red (near) disc's centroid. If it shifts frame to
// frame, the "nobody moves" fix is proven — with no generation, nothing paid.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderStill, openBrowser } from '@remotion/renderer';
import sharp from 'sharp';
import { findChromium } from './findChromium.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '../public/proof');
const OUT = path.resolve(__dirname, '../../', process.env.PROOF_OUT || 'proof-out');
const W = 1080, H = 1920;

fs.mkdirSync(PUBLIC, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// --- fixtures: a dead base plate, and two planes each holding one disc -------
async function disc(cx, cy, r, rgba) {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(${rgba})"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
// Base: solid dark with a faint fixed grid — if the base ever moved, the grid
// would betray it. It must NOT move (it is the background).
const gridLines = Array.from({ length: 40 }, (_, i) => {
  const x = i * (W / 40), y = i * (H / 40);
  return `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#1b2233" stroke-width="1"/>
          <line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#1b2233" stroke-width="1"/>`;
}).join('');
await sharp(Buffer.from(
  `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
     <rect width="${W}" height="${H}" fill="#0a0e1a"/>${gridLines}</svg>`,
)).png().toFile(path.join(PUBLIC, 'base.png'));
// NEAR plane (full gain): red disc, centre.
await sharp(await disc(W / 2, H / 2, 120, '235,40,40,1')).toFile(path.join(PUBLIC, 'near.png'));
// MID plane (half gain): green disc, upper third.
await sharp(await disc(W / 2, H / 3, 90, '40,220,90,1')).toFile(path.join(PUBLIC, 'mid.png'));

// --- the plan: one 4s shot, CAMERA LOCKED, both depth planes present ---------
const plan = {
  title: 'living-motion-proof',
  fps: 30,
  watermark: false, // keep frames clean for measurement
  shots: [
    {
      still: 'proof/base.png',
      seconds: 4,
      travel: 0, // CAMERA FROZEN — no pan, no push
      parallax: { near: 'proof/near.png', mid: 'proof/mid.png' },
    },
  ],
};

// Centroid of pixels matching a channel dominance test, in the raw RGB buffer.
async function centroid(file, pick) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      if (pick(data[o], data[o + 1], data[o + 2])) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : { x: NaN, y: NaN, n: 0 };
}
const isRed = (r, g, b) => r > 150 && g < 110 && b < 110;
const isGreen = (r, g, b) => g > 150 && r < 130 && b < 140;

async function main() {
  console.log('bundling story composition…');
  const serveUrl = await bundle({
    entryPoint: path.resolve(__dirname, '../src/story.ts'),
    webpackOverride: (c) => c,
  });
  const browser = await openBrowser('chrome', {
    browserExecutable: findChromium(),
    chromiumOptions: { gl: 'angle' },
    chromeMode: 'chrome-for-testing',
  });
  try {
    const composition = await selectComposition({
      serveUrl, id: 'story', puppeteerInstance: browser, inputProps: plan,
    });
    console.log(`composition: ${composition.durationInFrames} frames @ ${composition.fps}fps`);
    const frames = [0, 12, 24, 36, 48, 60, 72];
    const rows = [];
    for (const frame of frames) {
      const out = path.join(OUT, `frame-${String(frame).padStart(3, '0')}.png`);
      await renderStill({
        composition, serveUrl, output: out, frame, inputProps: plan,
        puppeteerInstance: browser, overwrite: true,
      });
      const red = await centroid(out, isRed);
      const green = await centroid(out, isGreen);
      rows.push({ frame, red, green });
      console.log(
        `frame ${String(frame).padStart(3)}: ` +
        `red(near)=(${red.x.toFixed(2)}, ${red.y.toFixed(2)}) n=${red.n}  ` +
        `green(mid)=(${green.x.toFixed(2)}, ${green.y.toFixed(2)}) n=${green.n}`,
      );
    }
    // Ranges: how far each disc's centroid travelled across the shot.
    const span = (arr, key, axis) => {
      const vals = arr.map((r) => r[key][axis]).filter(Number.isFinite);
      return Math.max(...vals) - Math.min(...vals);
    };
    const summary = {
      near_dx_px: span(rows, 'red', 'x'), near_dy_px: span(rows, 'red', 'y'),
      mid_dx_px: span(rows, 'green', 'x'), mid_dy_px: span(rows, 'green', 'y'),
    };
    console.log('\nCENTROID TRAVEL ACROSS THE SHOT (camera frozen):');
    console.log(`  near (red)  moved  Δx=${summary.near_dx_px.toFixed(2)}px  Δy=${summary.near_dy_px.toFixed(2)}px`);
    console.log(`  mid  (green) moved Δx=${summary.mid_dx_px.toFixed(2)}px  Δy=${summary.mid_dy_px.toFixed(2)}px`);
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ rows, summary }, null, 2));

    // A difference image (frame 0 vs the frame of peak travel) so the motion is
    // literally visible: where the disc moved, the diff lights up.
    const peak = rows.reduce((a, b) =>
      Math.hypot(b.red.x - rows[0].red.x, b.red.y - rows[0].red.y) >
      Math.hypot(a.red.x - rows[0].red.x, a.red.y - rows[0].red.y) ? b : a, rows[0]);
    const f0 = path.join(OUT, 'frame-000.png');
    const fp = path.join(OUT, `frame-${String(peak.frame).padStart(3, '0')}.png`);
    const a = await sharp(f0).raw().toBuffer();
    const b = await sharp(fp).raw().toBuffer();
    const diff = Buffer.alloc(a.length);
    for (let i = 0; i < a.length; i++) diff[i] = Math.min(255, Math.abs(a[i] - b[i]) * 4);
    await sharp(diff, { raw: { width: W, height: H, channels: 3 } })
      .png().toFile(path.join(OUT, 'diff-000-vs-peak.png'));
    console.log(`\ndiff image: frame 0 vs frame ${peak.frame} → ${path.join(OUT, 'diff-000-vs-peak.png')}`);
  } finally {
    await browser.close({ silent: true });
  }
}
main().then(() => { console.log('done'); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });

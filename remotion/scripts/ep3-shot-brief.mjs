// Print the exact generation brief for episode 3 shots — nothing hand-assembled.
//
//   bun scripts/ep3-shot-brief.mjs             # all 60 shots
//   bun scripts/ep3-shot-brief.mjs ep3_s02     # one scene
//   bun scripts/ep3-shot-brief.mjs ep3_s02b    # one shot
//   bun scripts/ep3-shot-brief.mjs --json ep3_s02
//   bun scripts/ep3-shot-brief.mjs --todo      # only shots with no clip yet
//
// This exists because sixty shots is sixty chances to compose a prompt by hand,
// and a hand-assembled prompt is how the style, the scene text and the cast
// locks drift apart. Every field below is resolved from the data:
//
//   STILL  = shotPromptFor(shot) — style, then the frame, then the cast locks.
//            Feeds the IMAGE model. Use it verbatim.
//   SHEETS = the reference art to attach, derived from the shot's cast keys.
//   MOTION = shot.motion alone. Feeds the VIDEO model as the prompt beside the
//            still. NEVER send the STILL text to the video model: it carries
//            character NAMES, and there is no reason to hand a name-matching
//            content classifier the word "Aladdin" when the still already
//            encodes everything the video model needs.
//   FRAMES = the exact conform length. Read, never recomputed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIPS = path.resolve(__dirname, '../public/ep3/clips');
const SHOTS_DIR = path.resolve(__dirname, '../public/ep3/shots');

const { EP3_SHOT_PLAN } = await import('../src/ep3/shots.ts').catch((err) => {
  throw new Error(`could not load the shot plan (${err.message}). Run with bun, not node.`);
});
const { FPS } = await import('../src/ep3/manifest.ts');
const { CHARACTER_SHEETS } = await import('../../src/data/originals.ts');
const { shotPromptFor } = await import('../../src/data/ep3Shots.ts');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const TODO = args.includes('--todo');
const filter = args.find((a) => !a.startsWith('--'));

/** A clip counts as done once it is on the CDN, whether or not it is local. */
const done = (shot) =>
  fs.existsSync(path.join(CLIPS, `${shot.id}.mp4.asset.json`)) ||
  fs.existsSync(path.join(CLIPS, `${shot.id}.mp4`));

/** A still may already exist from an earlier pass; say so rather than redoing it. */
const hasStill = (shot) => fs.existsSync(path.join(SHOTS_DIR, `${shot.id}.jpg`));

let shots = EP3_SHOT_PLAN;
if (filter) shots = shots.filter((s) => s.id === filter || s.sceneId === filter);
if (TODO) shots = shots.filter((s) => !done(s));
if (shots.length === 0) {
  console.error(filter ? `no shots match "${filter}"` : 'nothing to do — every clip exists');
  process.exit(1);
}

const brief = (shot) => ({
  id: shot.id,
  scene: shot.sceneId,
  frames: shot.frames,
  seconds: Number((shot.frames / FPS).toFixed(3)),
  // Missing sheets are reported rather than silently dropped: a cast key with
  // no art is a character about to be re-invented, and it should be noticed
  // before the generation rather than after it.
  sheets: (shot.cast ?? []).map((key) => ({ key, file: CHARACTER_SHEETS[key] ?? null })),
  still: shotPromptFor(shot),
  motion: shot.motion,
  transitionIn: shot.transitionIn ?? 'cut',
  stillExists: hasStill(shot),
  clipDone: done(shot),
});

if (JSON_OUT) {
  console.log(JSON.stringify(shots.map(brief), null, 2));
} else {
  for (const shot of shots) {
    const b = brief(shot);
    const sheets = b.sheets.length
      ? b.sheets.map((s) => s.file ?? `!! NO SHEET FOR ${s.key} !!`).join(', ')
      : '(none — faceless coverage, attach no sheet and put no readable face in frame)';
    console.log(`=== ${b.id}   ${b.frames} frames (${b.seconds}s)   in:${b.transitionIn}`);
    console.log(`    clip:${b.clipDone ? 'DONE' : 'todo'}  still:${b.stillExists ? 'exists' : 'todo'}`);
    console.log(`SHEETS: ${sheets}`);
    console.log(`STILL:  ${b.still}`);
    console.log(`MOTION: ${b.motion}`);
    console.log();
  }
  const todo = shots.filter((s) => !done(s)).length;
  console.log(`${shots.length} shot(s) listed, ${todo} still to generate.`);
}

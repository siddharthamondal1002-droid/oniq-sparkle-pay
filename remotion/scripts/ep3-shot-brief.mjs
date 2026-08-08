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
//            WHICH TOOL depends on this line. A shot WITH sheets should be made
//            with the tool that accepts reference images, even though it returns
//            a smaller frame — an A/B proved resolution does not survive into the
//            finished clip, and the sheets are the only thing holding eleven
//            characters together across sixty generations. A FACELESS shot has no
//            sheet to attach, so it should use the plain generator at its native
//            size. Consistency where it matters, resolution where it is free.
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
const { CHARACTER_SHEETS, SHEET_SAFE_TO_ATTACH } = await import('../../src/data/originals.ts');
const { shotPromptFor } = await import('../../src/data/ep3Shots.ts');

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const TODO = args.includes('--todo');
const filter = args.find((a) => !a.startsWith('--'));

/** A clip counts as done once it is on the CDN, whether or not it is local. */
const done = (shot) =>
  fs.existsSync(path.join(CLIPS, `${shot.id}.mp4.asset.json`)) ||
  fs.existsSync(path.join(CLIPS, `${shot.id}.mp4`));

/**
 * What a usable starting frame looks like.
 *
 * PORTRAIT AND READABLE, and that is deliberately all. An earlier version of
 * this demanded exactly 1080x1920 and it was wrong twice over:
 *
 *   - The image generator natively returns 1088x1920, the same macroblock
 *     rounding Veo has, so the rule made the agent crop 8px and re-encode —
 *     spending a JPEG generation to hand Veo a frame it then scaled back up.
 *   - An A/B on finished clips found 768x1376 sources INDISTINGUISHABLE from
 *     1080x1920 ones. Resolution, within this range, does not survive into the
 *     render, so refusing it would have cost thirteen regenerations for nothing.
 *
 * The two sizes correspond to two tools: `generate_image` gives native
 * 1088x1920 JPEG, `edit_image` gives 768x1376 PNG and is the ONLY one that
 * accepts character sheets. Both are legitimate — see the note in the header
 * about which to use for which shot — so this reports what a frame is and only
 * objects when it is unreadable or not portrait.
 */
const ASPECT = 9 / 16;
const ASPECT_TOLERANCE = 0.02;

/**
 * Format, width and height of an image, without a decoder.
 *
 * Handles JPEG and PNG, and reports WHICH — because the extension lies. Thirteen
 * of the first fifteen stills were PNGs named `.jpg`, which nothing noticed:
 * PIL sniffs content and read them happily, and a JPEG-only parser just called
 * them corrupt. Only dumping the magic bytes showed `89 50 4E 47`.
 *
 * The JPEG path walks the segment chain properly rather than scanning for a
 * marker byte. A naive scan finds the SOF of the EXIF *thumbnail* and reports
 * its size, which is how an earlier attempt returned 16381x65233 for a
 * perfectly good 1080x1920 file.
 */
function imageSize(file) {
  const buf = fs.readFileSync(file);

  // PNG: 8-byte signature, then IHDR length+type, then width and height.
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { format: 'PNG', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) return null;
    let marker = buf[i + 1];
    while (marker === 0xff && i + 2 < buf.length) marker = buf[++i + 1]; // fill bytes
    i += 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue; // standalone
    if (marker === 0xda) return null; // start of scan; dimensions precede it
    if (i + 1 >= buf.length) return null;
    const len = buf.readUInt16BE(i);
    const isSOF =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      return { format: 'JPEG', width: buf.readUInt16BE(i + 5), height: buf.readUInt16BE(i + 3) };
    }
    i += len;
  }
  return null;
}

/**
 * A still may already exist from an earlier pass — but "exists" is not enough.
 *
 * Thirteen of the first fifteen came back 768x1376: 1.4x short of the requested
 * resolution AND not 9:16 (0.558 vs 0.5625), so Veo had to letterbox or stretch
 * them up to 1088x1920. Nothing downstream caught it, because ingest only
 * inspects the finished clip, by which point the soft source is baked in.
 */
function stillState(shot) {
  const file = path.join(SHOTS_DIR, `${shot.id}.jpg`);
  if (!fs.existsSync(file)) return { has: false, ok: false, note: 'todo' };
  const img = imageSize(file);
  if (!img) return { has: true, ok: false, note: 'UNREADABLE — not a JPEG or PNG' };
  // The extension is part of the contract: an mislabelled file is a sign the
  // generation step did something other than what was asked.
  const aspect = img.width / img.height;
  const portrait = Math.abs(aspect - ASPECT) / ASPECT <= ASPECT_TOLERANCE;
  const what = `${img.width}x${img.height} ${img.format}`;
  return {
    has: true,
    ok: portrait,
    note: portrait ? what : `WRONG ASPECT ${what} (${aspect.toFixed(3)}, want ${ASPECT.toFixed(3)})`,
  };
}

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
  sheets: (shot.cast ?? []).map((key) => ({
    key,
    file: CHARACTER_SHEETS[key] ?? null,
    // A 2D sheet drags its own flat rendering into the frame. See
    // SHEET_SAFE_TO_ATTACH in originals.ts for the four shots that proved it.
    attach: SHEET_SAFE_TO_ATTACH[key] === true,
  })),
  still: shotPromptFor(shot),
  motion: shot.motion,
  transitionIn: shot.transitionIn ?? 'cut',
  still_state: stillState(shot),
  clipDone: done(shot),
});

if (JSON_OUT) {
  console.log(JSON.stringify(shots.map(brief), null, 2));
} else {
  for (const shot of shots) {
    const b = brief(shot);
    const attach = b.sheets.filter((s) => s.attach);
    const textOnly = b.sheets.filter((s) => !s.attach);
    const sheets = b.sheets.length
      ? [
          attach.length ? `ATTACH ${attach.map((s) => s.file).join(', ')}` : 'ATTACH nothing',
          textOnly.length
            ? `text-lock only (2D sheet, would flatten the render): ${textOnly.map((s) => s.key).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('  |  ')
      : '(none — faceless coverage, attach no sheet and put no readable face in frame)';
    console.log(`=== ${b.id}   ${b.frames} frames (${b.seconds}s)   in:${b.transitionIn}`);
    console.log(`    clip:${b.clipDone ? 'DONE' : 'todo'}  still:${b.still_state.note}`);
    console.log(`SHEETS: ${sheets}`);
    console.log(`STILL:  ${b.still}`);
    console.log(`MOTION: ${b.motion}`);
    console.log();
  }
  const todo = shots.filter((s) => !done(s)).length;
  const badStills = shots.filter((s) => stillState(s).has && !stillState(s).ok);
  console.log(`${shots.length} shot(s) listed, ${todo} still to generate.`);
  if (badStills.length > 0) {
    console.log(
      `\n!! ${badStills.length} still(s) are unusable:\n   ` +
        badStills.map((s) => `${s.id} ${stillState(s).note}`).join('\n   '),
    );
  }
}

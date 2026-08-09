// Which episode am I operating on, and what is in it?
//
// Every script here used to answer that with literals: `../public/ep3`, and
// `Array.from({ length: 16 })` for the scene list. That worked for exactly one
// episode. A fourth episode with a different scene count meant editing four
// scripts rather than running them, which is the kind of cost that quietly
// stops a second season from happening.
//
// So: `EPISODE=ep4 node scripts/measure-ep3.mjs`. It defaults to ep3, so every
// command already written down keeps working.
//
// THE SCENE COUNT IS DISCOVERED, NOT DECLARED. It comes from the narration mp3s
// actually on disk. A hardcoded 16 is wrong the moment an episode has fifteen
// scenes, and — worse — it is silently wrong when a file is missing: the script
// asks for a scene that is not there and reports it as an error in the audio
// rather than an error in itself.
//
// The filenames still say `ep3` for the same reason `render-ep1.mjs` still says
// ep1: the runbook, the skill and the transfer workflow all name them, and a
// rename buys nothing an env var does not already give. They are episode-
// agnostic despite the names.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The episode id — `ep1`, `ep2`, `ep3`, ... Defaults to ep3. */
export const EPISODE = process.env.EPISODE ?? 'ep3';

if (!/^ep\d+$/.test(EPISODE)) {
  throw new Error(`EPISODE must look like "ep3", got "${EPISODE}"`);
}

/** remotion/public/<episode> — narration, stills, and the clips directory. */
export const PUBLIC_DIR = path.resolve(__dirname, `../public/${EPISODE}`);
/** remotion/src/<episode> — manifest, shot plan, composition. */
export const SRC_DIR = path.resolve(__dirname, `../src/${EPISODE}`);
/** Conformed clips the composition reads. */
export const CLIPS_DIR = path.join(PUBLIC_DIR, 'clips');
/** Untrimmed generations, which is what a re-cut needs. */
export const RAW_DIR = path.join(PUBLIC_DIR, 'raw');

/**
 * Scene ids in order, discovered from the narration on disk.
 *
 * Sorted numerically rather than lexically, so an episode that ever reaches
 * `_s10` does not sort it between `_s01` and `_s02`. Zero-padding makes that
 * safe today and will not if anyone drops the padding.
 */
export function sceneIds() {
  if (!fs.existsSync(PUBLIC_DIR)) {
    throw new Error(`no such episode directory: ${PUBLIC_DIR} (EPISODE=${EPISODE})`);
  }
  const re = new RegExp(`^${EPISODE}_s(\\d+)\\.mp3$`);
  const found = fs
    .readdirSync(PUBLIC_DIR)
    .map((f) => ({ f, m: f.match(re) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => x.f.replace(/\.mp3$/, ''));

  if (found.length === 0) {
    throw new Error(
      `no narration found in ${PUBLIC_DIR} matching ${EPISODE}_sNN.mp3. ` +
        `Generate it first, or set EPISODE to an episode that exists.`,
    );
  }

  // A gap in the numbering means a missing file, and it must not be discovered
  // later as a scene that renders silent.
  for (let i = 0; i < found.length; i++) {
    const want = `${EPISODE}_s${String(i + 1).padStart(2, '0')}`;
    if (found[i] !== want) {
      throw new Error(
        `narration numbering has a gap: expected ${want}.mp3, found ${found[i]}.mp3. ` +
          `Scene ids must run 01..NN with no holes.`,
      );
    }
  }
  return found;
}

/**
 * `TRANSITION`, in seconds, read out of the episode's manifest.
 *
 * A regex rather than an import because these scripts run under node and the
 * manifest is TypeScript. It used to be a literal 0.5 in measure-ep3.mjs, and
 * when the real value became 0.25 that script silently reported an episode 105
 * frames shorter than the one that renders.
 */
export function transitionSeconds() {
  const file = path.join(SRC_DIR, 'manifest.ts');
  if (!fs.existsSync(file)) throw new Error(`no manifest at ${file}`);
  const m = fs.readFileSync(file, 'utf8').match(/export const TRANSITION\s*=\s*([\d.]+)/);
  if (!m) throw new Error(`could not find TRANSITION in ${file}`);
  return Number(m[1]);
}

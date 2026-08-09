// Locate the ffmpeg and ffprobe that ship inside Remotion's compositor.
//
// Extracted from measure-ep3.mjs when verify-episode.mjs needed the same
// lookup, for the same reason findChromium.mjs was extracted from three copies:
// a path list that lives in two files drifts, and the failure when it does is
// "no ffmpeg found" on a box that has one.
//
// THIS BINARY IS A CUT-DOWN BUILD. It has libx264, the mp4 and wav muxers,
// crop, scale, trim and silencedetect. It does NOT have fps, setpts, zoompan,
// drawtext, hue, eq, psnr, blend, signalstats or volumedetect. Reach for a
// filter that is not on that list and it fails outright rather than degrading,
// which is at least honest. `-r 30` as an OUTPUT option is the working
// substitute for the missing `fps` filter.
//
// A system ffmpeg, if there is one, is preferred via the env override —
// `FFMPEG=/usr/bin/ffmpeg` — because a full build has the analysis filters this
// one lacks. There is no system ffmpeg in the render container, which is why
// the compositor's copy is the default rather than the fallback.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

/**
 * @param {'ffmpeg' | 'ffprobe'} name
 * @returns {string} absolute path to the binary
 */
export function findBin(name) {
  const env = process.env[name.toUpperCase()];
  if (env) return env;
  const candidates = [
    path.join(REPO, `remotion/node_modules/@remotion/compositor-linux-x64-gnu/${name}`),
    // A scratch install, which is how this gets built on a box whose bun.lock
    // points at a private mirror it cannot reach.
    ...fs
      .readdirSync('/tmp', { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => `/tmp/${d.name}/node_modules/@remotion/compositor-linux-x64-gnu/${name}`),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error(`no ${name} found; set ${name.toUpperCase()}=/path/to/${name}`);
  return found;
}

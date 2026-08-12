// The film look: one ffmpeg pass that makes a rendered Story read as FILMED.
//
// RUNG 0 of the in-house video ladder, built from the measured research
// (2026-08-12): a grade pass over the finished master costs one to two CENTS
// of CPU per finished minute — against ~$9/min for a video model — and is
// most of the visible gap between "slideshow" and "looks shot". Measured in
// this container: 1.6x realtime at 1080x1920@30 on 4 vCPU with the whole
// chain below.
//
// WHY A POST-PASS AND NOT CSS IN THE COMPOSITION. Remotion rasterises CSS
// filters through Chromium, which is slower per pixel than ffmpeg's SIMD
// filters for full-frame work — and a post-pass grades the film once instead
// of per frame inside the render loop. Remotion keeps rendering the CLEAN
// image; the look is applied to the master afterwards, which also means a
// look change never invalidates a render.
//
// THE CHAIN, in order, each doing one photographic job:
//   drift      slow 2-3px sinusoidal wander — a camera held, not locked
//   halation   bright areas bloom softly, the way lens+film handles light
//   CA         one-pixel red/blue fringe at edges — a real lens, not a scan
//   curves     gentle S plus lifted black point — film's toe and shoulder
//   saturation +6%, contrast +2% — the "print" against the flat master
//   vignette   edges fall off, the frame holds the eye
//   grain      LAST, after everything, so the encoder carries it cleanly —
//              the research's ordering rule, and its biggest single cost
//              (~36% of the pass; the look is unmistakably poorer without it)
//
// FAILURE IS A STEP-DOWN. Any error here leaves the clean master exactly
// where it was and the caller ships that instead — a film without the grade
// beats no film, the same rule the dialogue and Rhubarb stages follow.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/** The grade, as one filter graph. Exported so a test can pin its shape. */
export const FILM_LOOK_GRAPH = [
  // Geometry first: over-scan 2% and wander inside it. Incommensurate
  // periods (7s and 11s) so the drift never visibly loops.
  "[0:v]scale=iw*1.02:ih*1.02,crop=1080:1920:x='(iw-ow)/2+3*sin(2*PI*t/7)':y='(ih-oh)/2+2*sin(2*PI*t/11)'[base]",
  '[base]split[a][b]',
  // Halation: keep only near-white luma, blur it wide, screen it back faintly.
  "[b]lutyuv=y='if(gt(val,190),val,0)':u=128:v=128,gblur=sigma=20[glow]",
  '[a][glow]blend=all_mode=screen:all_opacity=0.22[hal]',
  // Lens, print, frame, stock — in that order, grain dead last.
  "[hal]rgbashift=rh=1:bh=-1,curves=master='0/0.02 0.3/0.26 0.7/0.74 1/0.98',eq=saturation=1.06:contrast=1.02,vignette,noise=alls=5:allf=t[out]",
].join(';');

/**
 * Grade `inFile` into `outFile`. Audio is copied untouched — the pass owns
 * pixels only. Throws on failure; the caller decides what shipping means.
 */
export function applyFilmLook(ffmpeg, inFile, outFile) {
  execFileSync(
    ffmpeg,
    [
      '-y', '-v', 'error',
      '-i', inFile,
      '-filter_complex', FILM_LOOK_GRAPH,
      '-map', '[out]', '-map', '0:a?',
      '-c:a', 'copy',
      // veryfast, not medium: the filters are the cost here, and the preset
      // difference is invisible on a 1080-wide phone screen at crf 21 —
      // measured 1.6x realtime for the whole pass against 2.16x at medium.
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile,
    ],
    { stdio: 'pipe' },
  );
  const bytes = fs.statSync(outFile).size;
  if (bytes < 1024) throw new Error(`film look wrote ${bytes} bytes — not a film`);
  return bytes;
}

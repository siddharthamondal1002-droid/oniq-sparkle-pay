/**
 * Promo-shot theme — the promo's palette with LOCAL fonts.
 *
 * Deliberately not an import of ../theme: that module fetches Space Grotesk
 * and DM Sans from fonts.gstatic.com at module scope, which dies behind a
 * proxy whose CA headless Chromium does not trust — the exact trap the
 * episodes' separate entry point exists to avoid. The woff2 files here ship
 * in remotion/public/fonts and load through the FontFace API, so a render
 * needs no network at all.
 */
import { continueRender, delayRender, staticFile } from 'remotion';

export const display = 'ShotDisplay';
export const body = 'ShotBody';

const FACES: Array<[string, string, string]> = [
  [display, 'fonts/space-grotesk-latin-700-normal.woff2', '700'],
  [display, 'fonts/space-grotesk-latin-500-normal.woff2', '500'],
  [body, 'fonts/inter-latin-400-normal.woff2', '400'],
  [body, 'fonts/inter-latin-500-normal.woff2', '500'],
];

if (typeof document !== 'undefined') {
  const handle = delayRender('shot fonts');
  Promise.all(
    FACES.map(([family, file, weight]) =>
      new FontFace(family, `url(${staticFile(file)})`, { weight })
        .load()
        .then((f) => document.fonts.add(f)),
    ),
  )
    .then(() => continueRender(handle))
    .catch(() => continueRender(handle));
}

/** Same hexes as the shipped promo (src/theme.ts). Change both or neither. */
export const C = {
  bg: '#0E0F13',
  surface: '#16181E',
  line: '#242833',
  teal: '#00D4B8',
  ember: '#FF8A3D',
  text: '#F3F5F7',
  muted: '#8A93A3',
};

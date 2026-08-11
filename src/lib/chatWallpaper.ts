/**
 * The default chat wallpaper: a light doodle field, not a flat dark slab.
 *
 * WHY. A plain dark background made every thread read as a terminal — the
 * bubbles had nothing to sit on and the screen looked unfinished next to any
 * mainstream messenger. Every one of those uses a patterned, LIGHT surface
 * behind the bubbles for the same two reasons: the pattern gives the eye
 * something to measure bubble edges against, and a light field makes dark
 * bubble text the highest-contrast thing on screen.
 *
 * BAKED AS AN SVG DATA URI, not an image request. It is under 2 KB, it never
 * touches the network, it cannot fail to load and leave a bare background
 * mid-scroll, and it scales to any density without a second asset. The tile is
 * deliberately irregular — a 160px grid with items at odd offsets — because a
 * regular grid reads as a texture error rather than as hand-drawn doodles.
 *
 * The user's own wallpaper always wins; this is only what they get before they
 * pick one.
 */

/** Warm paper tone the doodles are drawn on. */
export const DOODLE_BASE = "#ece5dc";

/** Ink for the doodles — warm grey-brown, low contrast against the base. */
const INK = "%23c9bfb2";

// One 160×160 tile. Strokes only, no fills, so the whole thing stays tiny.
const TILE = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>
<g fill='none' stroke='${INK}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>
<path d='M12 18h22a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H22l-6 5v-5h-4a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z'/>
<path d='M104 14c3-4 9-4 11 1 2-5 8-5 11-1 3 4 0 9-11 17-11-8-14-13-11-17z'/>
<path d='M64 52l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z'/>
<path d='M128 46v18a5 5 0 1 1-3-4.6V49l12-3v14a5 5 0 1 1-3-4.6'/>
<path d='M18 84h14l3-5h10l3 5h6a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V87a3 3 0 0 1 3-3z'/>
<circle cx='38' cy='95' r='6'/>
<circle cx='112' cy='96' r='13'/>
<path d='M107 93.5h.01M117 93.5h.01M106 101c3 3.5 9 3.5 12 0'/>
<path d='M74 122l64-14-26 34-8-13z'/>
<path d='M104 129l4 14'/>
<path d='M20 130h20a7 7 0 0 1 0 14H24a4 4 0 0 1-4-4z'/>
<path d='M40 133h4a4 4 0 0 1 0 8h-2'/>
<path d='M146 78c0 4-3 7-7 7s-7-3-7-7 7-13 7-13 7 9 7 13z'/>
</g>
</svg>`;

/** CSS `background-image` value: the doodle tile over the paper tone. */
export const DOODLE_BACKGROUND_IMAGE = `url("data:image/svg+xml,${TILE.replace(/\n/g, "")
  .replace(/"/g, "'")
  .replace(/#/g, "%23")}")`;

/** Everything a surface needs to wear the default wallpaper. */
export const doodleSurfaceStyle: React.CSSProperties = {
  backgroundColor: DOODLE_BASE,
  backgroundImage: DOODLE_BACKGROUND_IMAGE,
  backgroundRepeat: "repeat",
  backgroundSize: "320px 320px",
};

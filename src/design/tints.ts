/**
 * THE TINT NAMES — the hues an icon badge can be drawn in.
 *
 * A plain module, no React, because DATA files name a tint: the Create
 * capabilities, the world icons, the attachment rows. Those files stay
 * framework-agnostic, so the type they import has to be too, and
 * OniqIconBadge re-exports it for components.
 *
 * A name, never a hex. The values live in exactly one place — the
 * [data-tint] blocks in src/styles.css — so a hue can be corrected once and
 * every badge in the app follows. src/design/__tests__/tints.test.ts parses
 * that file and fails if a name here has no block, or a block here has no
 * name: a badge tinted with a hue that does not exist renders grey, silently,
 * and nothing else would catch it.
 */
export const TINTS = [
  "rose",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "sky",
  "blue",
  "indigo",
  "violet",
  "pink",
  "slate",
] as const;

export type Tint = (typeof TINTS)[number];

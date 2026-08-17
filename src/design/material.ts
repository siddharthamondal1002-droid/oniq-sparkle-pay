/**
 * MATERIAL 3, AS ONIQ USES IT.
 *
 * Owner directive, 2026-08-17: "Material grid, Material spacing tokens,
 * elevation system, Material components. do the real design project."
 *
 * WHY THIS FILE EXISTS AT ALL, given the tokens have to live in CSS for
 * Tailwind to generate utilities from them. Because a scale that exists only
 * as CSS custom properties cannot be READ — not by a test, not by a component
 * deciding an elevation from a prop, not by a reviewer asking "is 14px on the
 * scale?". So the numbers live here, the CSS mirrors them, and
 * material.test.ts parses styles.css and fails if the two ever disagree. That
 * is the same mirror-and-parse arrangement storyPricing.ts has against the
 * pricing SQL, and it exists for the same reason: two copies of a number
 * drift, and nobody notices until something looks wrong in production.
 *
 * WHAT THIS IS NOT. It is not a licence to restyle ONIQ into stock Material.
 * The palette, the fonts and the brand stay exactly as they are — Material 3
 * is a system of METRICS (spacing, shape, elevation, type ramp, layout grid),
 * and those are what is adopted here. Anything that would change how ONIQ
 * looks rather than how consistently it is measured is a separate decision
 * and not this file's business.
 */

/**
 * THE 4dp BASELINE GRID.
 *
 * Material lays everything out on multiples of 4. Tailwind's default spacing
 * scale is already 4px per step (`p-1` = 0.25rem = 4px), so the grid is not
 * something to install — it is something to STOP BREAKING. The named steps
 * below are the ones Material actually calls out, so a component can say
 * `SPACING.md` and a reviewer can see the intent rather than counting.
 *
 * The offenders are the arbitrary values: `p-[7px]`, `gap-[13px]`, `mt-[3px]`.
 * Each is individually harmless and collectively the reason a screen never
 * quite lines up with the one beside it.
 */
export const SPACING = {
  none: 0,
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

/**
 * SHAPE — Material 3's corner radius scale.
 *
 * M3 shape is a fixed ramp rather than a free number, and the jump from `lg`
 * (16) to `xl` (28) is deliberate in the spec: 28 is the "expressive" corner
 * used by dialogs, FABs and bottom sheets, and nothing sits between.
 *
 * ONIQ's existing `--radius: 1rem` IS Material's `lg`, which is a piece of
 * luck worth naming: the app was already built on the M3 default corner, so
 * adopting the ramp does not move any existing surface.
 */
export const SHAPE = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  full: 9999,
} as const;

/**
 * ELEVATION — M3 levels 0 to 5.
 *
 * THE PART PEOPLE GET WRONG: in Material 3 elevation is TWO things at once, a
 * shadow AND a surface tint. A dark-theme card does not read as "raised"
 * because of its shadow — a shadow is nearly invisible against #0e0f13 — it
 * reads as raised because its surface is tinted toward the primary colour by
 * an amount that grows with the level. Shipping only the shadows would give a
 * flat app that technically has an elevation system.
 *
 * So each level carries both, and the tint opacities are M3's own: 0%, 5%,
 * 8%, 11%, 12%, 14%.
 *
 * The levels have jobs, and naming them is what stops "elevation-3 because it
 * looked nice": 0 flat surfaces, 1 cards at rest, 2 the raised state of
 * something interactive, 3 dialogs and menus, 4 navigation drawers, 5 the
 * thing dragged above everything else.
 */
export const ELEVATION = [
  { level: 0, tint: 0, shadow: "none", use: "flat surfaces, the page itself" },
  { level: 1, tint: 0.05, shadow: "0 1px 2px 0 rgb(0 0 0 / 0.30), 0 1px 3px 1px rgb(0 0 0 / 0.15)", use: "cards at rest" },
  { level: 2, tint: 0.08, shadow: "0 1px 2px 0 rgb(0 0 0 / 0.30), 0 2px 6px 2px rgb(0 0 0 / 0.15)", use: "raised, hovered, pressed" },
  { level: 3, tint: 0.11, shadow: "0 4px 8px 3px rgb(0 0 0 / 0.15), 0 1px 3px 0 rgb(0 0 0 / 0.30)", use: "dialogs, menus, sheets" },
  { level: 4, tint: 0.12, shadow: "0 6px 10px 4px rgb(0 0 0 / 0.15), 0 2px 3px 0 rgb(0 0 0 / 0.30)", use: "navigation drawer" },
  { level: 5, tint: 0.14, shadow: "0 8px 12px 6px rgb(0 0 0 / 0.15), 0 4px 4px 0 rgb(0 0 0 / 0.30)", use: "dragged above everything" },
] as const;

export type ElevationLevel = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * THE TYPE RAMP.
 *
 * Fifteen roles in three sizes each. The floor is what already has a lint rule
 * behind it: `oniq/a11y-type-scale` rejects anything under 11px, because
 * labelSmall is 11sp and bodySmall is 12sp and there is nothing beneath them
 * in the scale. That rule predates this file and agrees with it — the ramp
 * below is the rest of the same system, written down.
 *
 * Sizes are px so they can be compared against what components actually
 * write; line heights are unitless multipliers.
 */
export const TYPE = {
  displayLarge: { size: 57, line: 1.12, weight: 400, tracking: -0.25 },
  displayMedium: { size: 45, line: 1.16, weight: 400, tracking: 0 },
  displaySmall: { size: 36, line: 1.22, weight: 400, tracking: 0 },
  headlineLarge: { size: 32, line: 1.25, weight: 400, tracking: 0 },
  headlineMedium: { size: 28, line: 1.29, weight: 400, tracking: 0 },
  headlineSmall: { size: 24, line: 1.33, weight: 400, tracking: 0 },
  titleLarge: { size: 22, line: 1.27, weight: 400, tracking: 0 },
  titleMedium: { size: 16, line: 1.5, weight: 500, tracking: 0.15 },
  titleSmall: { size: 14, line: 1.43, weight: 500, tracking: 0.1 },
  bodyLarge: { size: 16, line: 1.5, weight: 400, tracking: 0.5 },
  bodyMedium: { size: 14, line: 1.43, weight: 400, tracking: 0.25 },
  bodySmall: { size: 12, line: 1.33, weight: 400, tracking: 0.4 },
  labelLarge: { size: 14, line: 1.43, weight: 500, tracking: 0.1 },
  labelMedium: { size: 12, line: 1.33, weight: 500, tracking: 0.5 },
  labelSmall: { size: 11, line: 1.45, weight: 500, tracking: 0.5 },
} as const;

/** Nothing in the ramp is smaller than this, which is what the lint rule guards. */
export const MIN_TYPE_PX = 11;

/**
 * THE LAYOUT GRID — M3 window size classes.
 *
 * Material sizes a layout by the WINDOW's width class, not by a device guess,
 * and each class carries its own margin and gutter. ONIQ is a phone app first
 * and every one of its users today is in `compact`, so the honest note is
 * that the other classes are correctness for tablets and the web, not a
 * redesign anybody will see this week.
 *
 * `columns` is what a responsive grid divides into at that width. `margin` is
 * the page's own outer padding; `gutter` the gap between columns.
 */
export const WINDOW_CLASSES = [
  { name: "compact", min: 0, columns: 4, margin: 16, gutter: 16 },
  { name: "medium", min: 600, columns: 12, margin: 24, gutter: 24 },
  { name: "expanded", min: 840, columns: 12, margin: 24, gutter: 24 },
  { name: "large", min: 1200, columns: 12, margin: 24, gutter: 24 },
  { name: "extraLarge", min: 1600, columns: 12, margin: 24, gutter: 24 },
] as const;

export type WindowClass = (typeof WINDOW_CLASSES)[number]["name"];

/** Which window class a width falls in. Widest match wins. */
export function windowClassFor(width: number): WindowClass {
  let found: WindowClass = "compact";
  for (const c of WINDOW_CLASSES) if (width >= c.min) found = c.name;
  return found;
}

/**
 * MINIMUM TOUCH TARGET, 48dp.
 *
 * Material's number and WCAG 2.5.8's, near enough, and the one metric in this
 * file that is an accessibility floor rather than a matter of taste. A 32px
 * icon button is not "compact"; it is a control some people cannot reliably
 * hit.
 */
export const MIN_TOUCH_PX = 48;

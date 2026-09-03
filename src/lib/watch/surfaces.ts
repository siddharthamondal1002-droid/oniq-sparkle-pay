/**
 * The library's surfaces, shared by the library screen and the Home card
 * that deep-links into it. One list, so a chip on Home can only name a
 * surface the library actually has, and a stale ?surface= in a URL falls
 * back to Continue instead of an empty screen.
 */
export const WATCH_SURFACES = [
  "continue",
  "inbox",
  "resurface",
  "following",
  "collections",
  "threads",
  "movies",
  "library",
] as const;
export type WatchSurface = (typeof WATCH_SURFACES)[number];

export function parseSurface(v: unknown): WatchSurface | undefined {
  return typeof v === "string" && (WATCH_SURFACES as readonly string[]).includes(v)
    ? (v as WatchSurface)
    : undefined;
}

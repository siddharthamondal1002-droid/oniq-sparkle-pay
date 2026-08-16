/**
 * Types for the ffmpeg/ffprobe lookup, so tests can import it under `tsc`.
 *
 * The binary this returns is normally Remotion's compositor build, which is
 * CUT DOWN — libx264 and the mp4/wav muxers, but almost no filters. Anything
 * built against it must stay inside that surface; see the note in
 * findFfmpeg.mjs for the list, and syntheticMp4 in storyFixtures.mjs for what
 * happens when something strays outside it.
 */
export function findBin(name: "ffmpeg" | "ffprobe"): string;

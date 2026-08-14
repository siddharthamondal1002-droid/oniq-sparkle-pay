// RUNG 8 — the sound stage. What the scene sounds like under the narrator.
//
// Every film so far has been narration over dead silence, which is the audio
// version of the frozen JPEG shotGrammar's commentary warns about: no real
// place is silent. This module gives a movie-grade shot an AMBIENT BED —
// wind over the dunes, rain on the market awnings, crickets after dark —
// chosen from the shot's own words and synthesized deterministically by the
// worker with ffmpeg's lavfi sources. No licensed assets, no downloads, no
// cost, and the same seed renders the same air forever.
//
// THE HONESTY RULE, same as every rung: a scene that names no weather, no
// water, no fire and no darkness gets NOTHING. A quiet interior under plain
// narration is honest; generic "movie air" pasted on everything is the
// audio metronome this engine keeps refusing to build.
//
// ZERO IMPORTS, like its siblings — the story worker loads this file under
// Node's type-stripping, where an extensionless import chain dies.
//
// MIXING CONTRACT (enforced by StoryFilm, pinned by tests): the bed plays
// UNDER the narration at AMBIENT_GAIN with AMBIENT_FADE_SECONDS edges.
// Narration stays the clock and is never ducked — the two audio bugs ep3
// shipped were both mixing surprises, so the mix here is one constant and
// two fades, nothing cleverer.

export type AmbienceKind =
  | "rain"
  | "surf"
  | "fire"
  | "cave"
  | "wind"
  | "night";

/** Bed volume relative to full-scale narration. Present, not competing. */
export const AMBIENT_GAIN = 0.16;

/** Edge fades, so a bed never pops at a hard cut. */
export const AMBIENT_FADE_SECONDS = 0.8;

/**
 * What the scene's words earn, or null. Precedence is specific-first:
 * falling water beats standing water beats fire beats stone beats moving
 * air, and night's crickets are the FALLBACK for quiet darkness — an
 * explicitly windy night is a wind scene, which is why wind outranks
 * night despite being the vaguest sound here.
 */
export function ambienceFor(text: string): AmbienceKind | null {
  const t = text.toLowerCase();
  // rain(?!bow): a rainbow is dry. "brain", "training" die on the boundary.
  if (/\b(?:rain(?!bow)\w*|drizzl|downpour|monsoon|thunderstorm)/.test(t)) {
    return "rain";
  }
  // surf(?!ace): a surface is not the sea. waves\b guarded against the
  // gesture — "waves goodbye / waves his hand" is an arm, not water.
  if (
    /\b(?:sea\b|ocean|shore|coast|tide|surf(?!ace)|breakers|waves\b(?!\s+(?:goodbye|farewell|his\b|her\b|their\b|him\b|them\b|at\b|to\b)))/.test(
      t,
    )
  ) {
    return "surf";
  }
  // fire(?!fl): a firefly is rung 3's problem — it twinkles, it does not
  // crackle. Torches, hearths and braziers all carry flame.
  if (
    /\b(?:fire(?!fl)\w*|hearth|campfire|bonfire|flame|ember|blaz|brazier|torch)/.test(t)
  ) {
    return "fire";
  }
  // cave(?:rn|s)?\b: "caved in" is a collapse, not a place.
  if (/\b(?:cave(?:rn|s)?\b|grotto|catacomb|crypt\b|underground|tunnel)/.test(t)) {
    return "cave";
  }
  // wind(?:y|s)?\b: the boundary kills "window" and "winding road".
  if (/\b(?:wind(?:y|s)?\b|windswept|windstorm|gust|breez|gale|howl)/.test(t)) {
    return "wind";
  }
  // night(?!mare): dreams are silent. "knight" dies on the boundary.
  if (/\b(?:night(?!mare)\w*|midnight|moonl|starlit|starry|dusk|crickets)/.test(t)) {
    return "night";
  }
  return null;
}

/**
 * The bed's volume at one frame: AMBIENT_GAIN inside the shot, easing to
 * zero over AMBIENT_FADE_SECONDS at both edges so a hard cut never pops.
 * Pure, so the composition's <Audio volume> callback stays deterministic.
 */
export function ambientVolumeAt(
  frame: number,
  durationInFrames: number,
  fps: number,
): number {
  if (fps <= 0 || durationInFrames <= 0) return 0;
  const fade = Math.max(1, AMBIENT_FADE_SECONDS * fps);
  const rise = (frame + 1) / fade;
  const fall = (durationInFrames - frame) / fade;
  return AMBIENT_GAIN * Math.max(0, Math.min(1, rise, fall));
}

/**
 * The synthesis recipes: one ffmpeg lavfi graph per bed, parameterized by
 * seed so every film's air is its own yet reproducible. The worker runs
 * `ffmpeg -f lavfi -i "<graph>" -t <seconds>` verbatim — these strings ARE
 * the sound design, which is why tests pin their shape.
 *
 * Design notes per bed, from the spectral proofs:
 * - rain: broadband hiss, high-passed so it sits above the narrator.
 * - surf: brown noise under a ~9-second swell — the wave period.
 * - fire: low rumble plus a fast shallow flicker for the crackle band.
 * - cave: near-subsonic air with a slow four-second breath.
 * - wind: pink noise low-passed to a moan, gusting on a slow LFO.
 * - night: two detuned cricket chirps pulsing at insect rates over a
 *   whisper of air; the chirps live near 4kHz like the real thing.
 */
export function ambienceGraph(kind: AmbienceKind, seed: number): string {
  const s = Math.abs(Math.trunc(seed)) % 99991;
  switch (kind) {
    case "rain":
      return `anoisesrc=colour=white:seed=${s}:amplitude=0.55,highpass=f=900,lowpass=f=7500,tremolo=f=0.4:d=0.12`;
    case "surf":
      return `anoisesrc=colour=brown:seed=${s}:amplitude=0.8,lowpass=f=850,tremolo=f=0.11:d=0.75`;
    case "fire":
      return `anoisesrc=colour=brown:seed=${s}:amplitude=0.7,lowpass=f=500,tremolo=f=7:d=0.25,tremolo=f=0.9:d=0.3`;
    case "cave":
      return `anoisesrc=colour=brown:seed=${s}:amplitude=0.6,lowpass=f=220,tremolo=f=0.25:d=0.5`;
    case "wind":
      return `anoisesrc=colour=pink:seed=${s}:amplitude=0.65,lowpass=f=420,tremolo=f=0.18:d=0.65`;
    case "night": {
      // Chirp rates offset per seed so two night scenes never sing in
      // unison; both stay in the 11-15Hz band real crickets pulse at.
      const fA = 12 + (s % 3);
      const fB = 13.5 + (s % 2);
      return (
        `sine=frequency=4230:beep_factor=0[cA];` +
        `sine=frequency=3870:beep_factor=0[cB];` +
        `anoisesrc=colour=pink:seed=${s}:amplitude=0.12,lowpass=f=600[air];` +
        `[cA]tremolo=f=${fA}:d=0.95,volume=0.20[a];` +
        `[cB]tremolo=f=${fB}:d=0.95,volume=0.16[b];` +
        `[a][b][air]amix=inputs=3:normalize=0`
      );
    }
  }
}

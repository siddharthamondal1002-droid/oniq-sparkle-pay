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

// ---------------------------------------------------------------------------
// RUNG 11 — the score. One film, one register, one chord held under it all.
//
// DELIBERATELY NOT MUSIC-SHAPED: no melody, no rhythm, no progression — a
// sustained modal drone in the film's aggregated emotional register, a
// full octave below the narrator and quieter than the ambient beds. The
// honest failure mode of procedural music is composition, so this rung
// refuses to compose: it holds one chord the way a string section holds a
// pedal tone under narration. A film whose shots earned no emotion gets
// NO score — the same absence rule as everything else.

/** Registers a whole film can hold. Surprise is a moment, not a movie. */
export type ScoreRegister = "joy" | "sorrow" | "anger" | "wonder" | "weary";

/** Under the beds, which are under the voice. Texture, not accompaniment. */
export const SCORE_GAIN = 0.09;

/** Long edges: the score breathes in with the title and out with the fade. */
export const SCORE_FADE_SECONDS = 2.5;

/**
 * The film's register: a majority vote over the shots' rung-5 emotions.
 * Surprise ballots are discarded (a startled film is not a genre), null
 * ballots don't count, and a tie goes to the register that reached the
 * winning count first — earlier acts set a film's tone.
 */
export function scoreFor(emotions: ReadonlyArray<string | null>): ScoreRegister | null {
  const counts = new Map<ScoreRegister, number>();
  let best: ScoreRegister | null = null;
  for (const e of emotions) {
    if (e === "joy" || e === "sorrow" || e === "anger" || e === "wonder" || e === "weary") {
      const n = (counts.get(e) ?? 0) + 1;
      counts.set(e, n);
      if (best === null || n > (counts.get(best) ?? 0)) best = e;
    }
  }
  return best;
}

/**
 * The drone recipes: a root chosen by seed from three low keys, a chord
 * spelled in just ratios per register, one partial detuned +0.4Hz so the
 * chord beats slowly instead of standing still, all low-passed and under
 * a barely-there swell. The worker runs the graph verbatim, like the beds.
 *
 * Register voicings, from the spectral proofs:
 * - joy: major triad + octave — the open, lit chord.
 * - sorrow: minor triad, root dropped a fourth — lower and inward.
 * - anger: root, minor second cluster, fifth — a held tension, no triad.
 * - wonder: root, fifth, major ninth — open fifths stacked past the octave.
 * - weary: a bare low fifth, nothing else — the emptiest interval.
 */
export function scoreGraph(register: ScoreRegister, seed: number): string {
  const s = Math.abs(Math.trunc(seed)) % 99991;
  const root = [98, 110, 123.47][s % 3];
  const spell: Record<ScoreRegister, number[]> = {
    joy: [1, 1.25, 1.5, 2],
    sorrow: [0.75, 0.9, 1.125, 1.5],
    anger: [0.75, 0.8, 1.125],
    wonder: [1, 1.5, 2.25],
    weary: [0.75, 1.125],
  };
  const gains = [0.5, 0.34, 0.3, 0.22];
  const parts = spell[register].map((ratio, i) => {
    // The second partial carries the detune — the chord's slow breath.
    const f = (root * ratio + (i === 1 ? 0.4 : 0)).toFixed(2);
    return `sine=frequency=${f}[p${i}];[p${i}]volume=${gains[i] ?? 0.2}[v${i}];`;
  });
  const labels = spell[register].map((_, i) => `[v${i}]`).join("");
  return (
    parts.join("") +
    `${labels}amix=inputs=${spell[register].length}:normalize=0,` +
    // f=0.1 is ffmpeg's tremolo floor — a ten-second swell, the slowest
    // breath the filter allows.
    `lowpass=f=650,tremolo=f=0.1:d=0.22`
  );
}

/** The score's volume envelope — AMBIENT-style, with the long fades. */
export function scoreVolumeAt(
  frame: number,
  totalFrames: number,
  fps: number,
): number {
  if (fps <= 0 || totalFrames <= 0) return 0;
  const fade = Math.max(1, SCORE_FADE_SECONDS * fps);
  const rise = (frame + 1) / fade;
  const fall = (totalFrames - frame) / fade;
  return SCORE_GAIN * Math.max(0, Math.min(1, rise, fall));
}

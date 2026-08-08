/**
 * Episode 2's audio, guarded at the two points where it can fail silently.
 *
 * MOUNTING. Episode 1 shipped with twelve narration files generated and not
 * one of them referenced — 4:47 of silent slideshow that no still-frame check,
 * no file size and no duration would have caught. Episode 2 now has two audio
 * layers, so there are two ways to make the same mistake.
 *
 * THE CURVE. The bed's gain is precomputed into a JSON array. A wrong length,
 * a NaN, or a step change are all invisible until playback, and the last of
 * them is audible as a click on a sustained pad.
 *
 * These read the composition as TEXT rather than importing it: remotion/ is
 * outside this TypeScript project (tsconfig includes only src/**), and a test
 * that cannot run is worse than no test.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { blankComments, executableText } from "@/test/sourceText";

const ROOT = join(__dirname, "../../..");
const composition = readFileSync(join(ROOT, "remotion/src/ep2/Episode2.tsx"), "utf8");
const manifest = readFileSync(join(ROOT, "remotion/src/ep2/manifest.ts"), "utf8");
const bed = JSON.parse(readFileSync(join(ROOT, "remotion/src/ep2/bedGain.json"), "utf8")) as {
  fps: number;
  frames: number;
  measured: { bedDb: number; narrationDb: number };
  levels: { under: number; alone: number };
  gain: number[];
};

describe("both audio layers are actually mounted", () => {
  // Comments AND string contents removed. Episode2.tsx describes the
  // silent-slideshow bug at length in a comment and names the mp3 path while
  // doing so; a naive grep would match the warning about the bug and pass on a
  // composition that mounts nothing.
  const code = executableText(composition);

  it("renders an Audio element at all", () => {
    expect(code).toMatch(/<Audio\b/);
  });

  it("mounts narration per scene, not just the bed", () => {
    // Two distinct Audio elements: one inside the scene loop, one at the root.
    const count = code.match(/<Audio\b/g)?.length ?? 0;
    expect(count, "expected a narration Audio and a bed Audio").toBeGreaterThanOrEqual(2);
  });

  it("references both the narration files and the bed file", () => {
    // String bodies are blanked by executableText, so assert on the template
    // expression and the staticFile calls that survive.
    expect(composition).toContain("ep2/${scene.id}.mp3");
    expect(composition).toContain("ep2/bed.mp3");
  });

  it("keeps the bed outside TransitionSeries", () => {
    // A bed inside the series is restarted and cross-faded at every scene
    // boundary: fifteen audible seams. It must be mounted before the series
    // opens.
    // The JSX USAGE, not the component definition. `MusicBed` alone also
    // matches `const MusicBed: React.FC`, which sits above the series no
    // matter where the element is actually rendered — that version of this
    // test passed with the bed moved inside, which is how the mistake was
    // found.
    const bedAt = code.indexOf("<MusicBed");
    const seriesAt = code.indexOf("<TransitionSeries>");
    expect(bedAt, "no <MusicBed /> element rendered").toBeGreaterThan(-1);
    expect(seriesAt).toBeGreaterThan(-1);
    expect(bedAt, "the bed must be mounted before TransitionSeries opens").toBeLessThan(seriesAt);
  });

  it("loops the bed with <Loop>, never the native `loop` attribute", () => {
    // This cost a full render. `<Audio loop />` type-checks, because
    // RemotionAudioProps extends React's native audio attributes and `loop` is
    // one of them — but the renderer does not honour it. The bed played once
    // for its 166 seconds and the last 169 seconds of the episode, more than
    // half, came out with no music. No warning, nothing visible in the file
    // size or duration; only an A/B render either side of the 166s mark showed
    // it.
    expect(code).toMatch(/<Loop\b/);
    expect(code, "bare `loop` on <Audio> is silently ignored when rendering").not.toMatch(
      /<Audio[^>]*\sloop[\s/>]/s,
    );
  });

  it("extends the volume curve across loop iterations", () => {
    // Inside a Loop the volume callback gets the frame relative to the current
    // iteration. The default would replay the first 166 seconds of the duck
    // curve over the second half — ducking against narration that is not
    // there. The curve is indexed by episode frame, so it needs "extend".
    //
    // blankComments, not executableText: the value IS a string literal, and
    // executableText blanks string bodies — it erased the very word being
    // looked for and the assertion failed on correct code. But the raw source
    // will not do either, because the comment above this prop quotes it
    // verbatim. Comments out, strings kept, is exactly this case.
    const withStrings = blankComments(composition).join("\n");
    expect(withStrings).toMatch(/loopVolumeCurveBehavior=["']extend["']/);
  });

  it("drives the bed from the precomputed curve rather than a constant", () => {
    expect(code).toMatch(/volume=\{/);
    expect(code).toContain("BED_GAIN");
  });
});

describe("the gain curve is usable", () => {
  it("declares its own length honestly", () => {
    expect(bed.gain).toHaveLength(bed.frames);
  });

  it("covers exactly the episode the manifest describes", () => {
    // Derived independently from the manifest text, so the curve and the
    // timeline cannot drift apart. A curve shorter than the episode leaves the
    // closing line unscored; longer, and it is out of sync throughout.
    const seconds = [...manifest.matchAll(/seconds:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const fps = Number(/export const FPS = (\d+)/.exec(manifest)![1]);
    const transition = Math.round(Number(/TRANSITION = ([\d.]+)/.exec(manifest)![1]) * fps);
    expect(seconds.length, "manifest scene count").toBe(16);
    const total =
      seconds.reduce((a, s) => a + Math.round(s * fps), 0) - transition * (seconds.length - 1);
    expect(bed.frames).toBe(total);
    expect(bed.fps).toBe(fps);
  });

  it("is finite everywhere", () => {
    expect(bed.gain.every((g) => Number.isFinite(g))).toBe(true);
  });

  it("never rises above its own calibrated alone level", () => {
    // Against the level this curve was actually built with, not a fallback
    // constant — the builder derives both gains from measured loudness.
    expect(Math.max(...bed.gain)).toBeLessThanOrEqual(bed.levels.alone + 1e-6);
  });

  it("puts the bed well under the narrator", () => {
    // The whole point. Measured RMS of both files, so this is the real
    // separation and not an intention. Episode 2's generated bed arrived
    // 10 dB LOUDER than the narration, which is why this is checked rather
    // than assumed.
    const underDb = bed.measured.bedDb + 20 * Math.log10(bed.levels.under);
    const separation = bed.measured.narrationDb - underDb;
    expect(separation, `bed is only ${separation.toFixed(1)} dB under the voice`).toBeGreaterThan(
      12,
    );
    // And not so far under that it is inaudible — that is not a bed, that is
    // a silent track that passes every other test here.
    expect(separation).toBeLessThan(24);
  });

  it("actually ducks in the BODY, not just at the fades", () => {
    // The edge fades run to zero, so min/max across the whole curve is
    // satisfied by the fade alone and says nothing about ducking. Look only
    // at the middle.
    const skip = 5 * bed.fps;
    const body = bed.gain.slice(skip, -skip);
    const range = Math.max(...body) - Math.min(...body);
    expect(range, "gain is flat through the episode — nothing is ducking").toBeGreaterThan(0.05);
  });

  it("does not step, on the real data and not just in theory", () => {
    let biggest = 0;
    for (let i = 1; i < bed.gain.length; i++) {
      biggest = Math.max(biggest, Math.abs(bed.gain[i] - bed.gain[i - 1]));
    }
    const range = bed.levels.alone - bed.levels.under;
    expect(biggest, `largest single-frame jump ${biggest}`).toBeLessThan(range * 0.25);
  });

  it("starts and ends silent", () => {
    expect(bed.gain[0]).toBe(0);
    expect(bed.gain[bed.gain.length - 1]).toBe(0);
  });
});

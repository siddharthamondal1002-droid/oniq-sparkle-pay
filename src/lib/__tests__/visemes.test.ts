/**
 * The invariants here are about what a viewer SEES, not about phonetics.
 *
 * This module is an approximation of forced alignment and its header says so at
 * length. Testing it against "is this the right phoneme" would be testing the
 * approximation against a standard it does not claim to meet. What it does
 * claim is narrower and fully checkable: the track covers every frame, no shape
 * flickers, the mouth is shut when nobody is speaking, and nothing drifts past
 * the audio it was measured from.
 *
 * The last one is the load-bearing property. Drift inside a speech run is
 * invisible; drift that accumulates across a scene ends with a mouth moving
 * after the voice has stopped, and that is the failure everybody sees.
 */
import { describe, expect, it } from "vitest";
import {
  REST,
  VISEME_WEIGHT,
  buildMouthCues,
  segmentsFromPauses,
  segmentsFromSpans,
  visemeAtFrame,
  wordToVisemes,
  type MouthCue,
  type SpeechSegment,
} from "@/lib/visemes";

const coverage = (cues: readonly MouthCue[]) => cues.reduce((a, c) => a + c.frames, 0);

describe("wordToVisemes turns letters into mouth shapes", () => {
  it("closes the mouth on m, b and p", () => {
    // The most visible shape there is. If "mama" does not close, nothing else
    // about the rig matters.
    expect(wordToVisemes("mama")).toEqual(["A", "D", "A", "D"]);
  });

  it("reads a digraph as one sound, not two letters", () => {
    // "sh" scanned as s-then-h spends two shapes on one sound, which makes the
    // mouth run ahead of the voice for the rest of the word.
    expect(wordToVisemes("shed")).toEqual(["B", "C", "B"]);
    expect(wordToVisemes("thin")).toEqual(["B", "C", "B"]);
    expect(wordToVisemes("moon")).toEqual(["A", "F", "B"]);
  });

  it("reads a doubled consonant as one sound", () => {
    expect(wordToVisemes("letter")).toEqual(["H", "C", "B", "C", "B"]);
  });

  it("drops a trailing silent e", () => {
    // Otherwise the mouth hangs open on a held C into the next word.
    expect(wordToVisemes("make")).toEqual(["A", "D", "B"]);
    expect(wordToVisemes("lamp")).toEqual(["H", "D", "A", "A"]);
  });

  it("keeps the e when it is actually spoken", () => {
    // Short words are not silent-e words, and neither is a vowel-e pair.
    expect(wordToVisemes("be")).toEqual(["A", "C"]);
    expect(wordToVisemes("the")).toEqual(["B", "C"]);
    expect(wordToVisemes("see")).toEqual(["B", "C"]);
  });

  it("costs nothing for punctuation", () => {
    // A comma that produced a shape would steal frames from a real sound.
    expect(wordToVisemes(",")).toEqual([]);
    expect(wordToVisemes("—")).toEqual([]);
    expect(wordToVisemes("")).toEqual([]);
  });

  it("never returns nothing for a word that had letters in it", () => {
    expect(wordToVisemes("'tis").length).toBeGreaterThan(0);
    expect(wordToVisemes("Aladdin!").length).toBeGreaterThan(0);
  });

  it("holds vowels longer than consonants", () => {
    // Uniform weights make the mouth chatter like a typewriter — the single
    // most recognisable way bad lip sync looks bad.
    expect(VISEME_WEIGHT.D).toBeGreaterThan(VISEME_WEIGHT.A);
    expect(VISEME_WEIGHT.C).toBeGreaterThan(VISEME_WEIGHT.B);
  });
});

describe("buildMouthCues covers the scene exactly", () => {
  const segments: SpeechSegment[] = [
    { startFrame: 10, endFrame: 70 },
    { startFrame: 90, endFrame: 150 },
  ];
  const text = "Aladdin found the lamp buried beneath the stone and lifted it into the light";

  it("covers every frame of the scene with no gaps and no overrun", () => {
    // A renderer looks up a frame and must always get an answer. A gap is a
    // frame with no mouth on the character at all.
    const cues = buildMouthCues(text, segments, 180);
    expect(coverage(cues)).toBe(180);
    expect(cues[0].startFrame).toBe(0);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startFrame, `cue ${i}`).toBe(cues[i - 1].startFrame + cues[i - 1].frames);
    }
  });

  it("rests everywhere outside the measured speech", () => {
    // The mouth must be shut when the voice is not there. This is the property
    // that makes the whole approach honest — the shapes are guesses, but WHEN
    // they happen is measured.
    const cues = buildMouthCues(text, segments, 180);
    for (const frame of [0, 5, 9, 70, 80, 89, 150, 179]) {
      expect(visemeAtFrame(cues, frame), `frame ${frame}`).toBe(REST);
    }
  });

  it("moves the mouth everywhere inside the measured speech", () => {
    const cues = buildMouthCues(text, segments, 180);
    for (const frame of [10, 30, 69, 90, 120, 149]) {
      expect(visemeAtFrame(cues, frame), `frame ${frame}`).not.toBe(REST);
    }
  });

  it("cannot drift past the audio, however long the text", () => {
    // The property that matters. Every segment is re-anchored to measured
    // frames, so a text three times too long for the audio still cannot leave
    // the mouth moving after the voice stops.
    const tooMuch = Array(200).fill("wonderful").join(" ");
    const cues = buildMouthCues(tooMuch, segments, 180);
    expect(coverage(cues)).toBe(180);
    expect(visemeAtFrame(cues, 150)).toBe(REST);
    expect(visemeAtFrame(cues, 179)).toBe(REST);
  });

  it("still rests correctly when the text is far too short", () => {
    const cues = buildMouthCues("oh", segments, 180);
    expect(coverage(cues)).toBe(180);
    expect(visemeAtFrame(cues, 5)).toBe(REST);
    expect(visemeAtFrame(cues, 175)).toBe(REST);
  });

  it("never holds a shape for fewer frames than the floor", () => {
    // Below two frames at 30fps a shape reads as a flicker, and a row of them
    // looks like a rendering fault rather than a mouth.
    const cues = buildMouthCues(tooMuchText(), segments, 180);
    for (const cue of cues) {
      expect(cue.frames, `${cue.viseme} at ${cue.startFrame}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("honours a raised floor", () => {
    const cues = buildMouthCues(tooMuchText(), segments, 180, { minHoldFrames: 5 });
    for (const cue of cues) {
      expect(cue.frames).toBeGreaterThanOrEqual(5);
    }
    expect(coverage(cues)).toBe(180);
  });

  it("merges neighbouring identical shapes into one cue", () => {
    // "one sound, one cue" — two abutting A cues are one closed mouth, and
    // emitting them separately makes the track lie about how many sounds there
    // were.
    const cues = buildMouthCues(text, segments, 180);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].viseme, `cue ${i} at ${cues[i].startFrame}`).not.toBe(cues[i - 1].viseme);
    }
  });

  it("emits no zero-frame cues", () => {
    for (const t of ["a", "the lamp", tooMuchText()]) {
      for (const cue of buildMouthCues(t, segments, 180)) {
        expect(cue.frames).toBeGreaterThan(0);
      }
    }
  });

  it("rests through a scene with no narration", () => {
    // An establishing shot. A still mouth, not an empty track the caller has
    // to special-case.
    const cues = buildMouthCues("", segments, 180);
    expect(cues).toEqual([{ startFrame: 0, frames: 180, viseme: REST }]);
  });

  it("rests through a scene with no measured speech", () => {
    const cues = buildMouthCues(text, [], 180);
    expect(cues).toEqual([{ startFrame: 0, frames: 180, viseme: REST }]);
  });

  it("returns nothing for a scene of no length", () => {
    expect(buildMouthCues(text, [], 0)).toEqual([]);
  });

  it("gives a longer segment more of the WORDS, not just more frames", () => {
    // Proportional distribution is the whole timing model: if a segment seven
    // times the length got the same share of words, the mouth would crawl
    // through one run and race through the other.
    //
    // Counting cues per segment does NOT test this — a longer segment holds
    // more shapes whatever share of the text it was given, so an equal split
    // passes that check. An earlier version of this test did exactly that and
    // survived a mutation to `segments.map(() => 1)`.
    //
    // So the text is built to make the split observable in the SHAPES. Eight
    // words: four "lee" (H, C) then four "pop" (A, E, A). The first segment is
    // seven times the second, so proportionally it takes seven words and must
    // reach the "pop"s — a closed A mouth. Split evenly it takes exactly the
    // four "lee"s and never closes.
    const lopsided: SpeechSegment[] = [
      { startFrame: 0, endFrame: 140 },
      { startFrame: 140, endFrame: 160 },
    ];
    const cues = buildMouthCues("lee lee lee lee pop pop pop pop", lopsided, 160);
    const firstSegment = cues.filter((c) => c.startFrame < 140);
    expect(firstSegment.map((c) => c.viseme)).toContain("A");
  });

  it("thins from the middle, so the mouth keeps moving to the end of a run", () => {
    // When a run cannot hold every shape, WHICH ones go matters. Keeping the
    // first N and dropping the tail stops the mouth before the sound does,
    // which reads as the voice continuing over a frozen face. Keeping the
    // first and last and thinning between them does not.
    //
    // 60 "sit" words (B, C, B) then one "mom" (A, E, A), crushed into 20
    // frames. Even spacing keeps the final A; front-loaded thinning never
    // reaches it.
    const text = `${Array(60).fill("sit").join(" ")} mom`;
    const cues = buildMouthCues(text, [{ startFrame: 0, endFrame: 20 }], 40);
    expect(visemeAtFrame(cues, 19)).toBe("A");
  });

  it("rests through a speech run too short to hold a single shape", () => {
    const tiny: SpeechSegment[] = [{ startFrame: 10, endFrame: 11 }];
    const cues = buildMouthCues("lamp", tiny, 30);
    expect(coverage(cues)).toBe(30);
    expect(visemeAtFrame(cues, 10)).toBe(REST);
  });
});

/** Enough text that every segment is over capacity, forcing shapes to be dropped. */
function tooMuchText(): string {
  return Array(80).fill("marvellous").join(" ");
}

describe("buildMouthCues rejects measurements that cannot be true", () => {
  it("rejects a non-integer or negative scene length", () => {
    expect(() => buildMouthCues("a", [], 12.5)).toThrow(/not a frame count/);
    expect(() => buildMouthCues("a", [], -1)).toThrow(/not a frame count/);
  });

  it("rejects a floor below one frame", () => {
    expect(() => buildMouthCues("a", [], 30, { minHoldFrames: 0 })).toThrow(/positive integer/);
  });

  it("rejects a segment running past the end of the scene", () => {
    // Silently clamping would put the mouth out of sync with the audio for the
    // whole rest of the scene, which is exactly the bug this module exists to
    // avoid. Fail at the measurement instead.
    expect(() => buildMouthCues("a", [{ startFrame: 0, endFrame: 200 }], 180)).toThrow(/past 180/);
  });

  it("rejects overlapping or reversed segments", () => {
    const overlapping = [
      { startFrame: 0, endFrame: 50 },
      { startFrame: 40, endFrame: 90 },
    ];
    expect(() => buildMouthCues("a", overlapping, 180)).toThrow(/overlaps/);
    expect(() => buildMouthCues("a", [{ startFrame: 50, endFrame: 50 }], 180)).toThrow(
      /empty or reversed/,
    );
  });

  it("rejects fractional frame boundaries", () => {
    expect(() => buildMouthCues("a", [{ startFrame: 0.5, endFrame: 50 }], 180)).toThrow(
      /whole frames/,
    );
  });
});

describe("visemeAtFrame answers for any frame", () => {
  // Built per test rather than in the describe body. A throw at collection
  // time fails the whole FILE with no test name attached, which is how a
  // regression in buildMouthCues showed up as "no tests" instead of pointing
  // at the assertion that caught it.
  const track = () => buildMouthCues("the lamp", [{ startFrame: 5, endFrame: 40 }], 60);

  it("rests outside the track rather than throwing", () => {
    const cues = track();
    // A renderer asking one frame past the end is a fencepost bug somewhere
    // else; a closed mouth is the right way to survive it.
    expect(visemeAtFrame(cues, -5)).toBe(REST);
    expect(visemeAtFrame(cues, 9999)).toBe(REST);
  });

  it("agrees with the cue that contains the frame, across the whole scene", () => {
    const cues = track();
    for (let f = 0; f < 60; f++) {
      const owner = cues.find((c) => f >= c.startFrame && f < c.startFrame + c.frames);
      expect(visemeAtFrame(cues, f), `frame ${f}`).toBe(owner?.viseme ?? REST);
    }
  });
});

describe("segmentsFromSpans is the real input path", () => {
  it("converts measured spans straight through", () => {
    expect(
      segmentsFromSpans(
        [
          [0, 20],
          [26, 62],
        ],
        100,
      ),
    ).toEqual([
      { startFrame: 0, endFrame: 20 },
      { startFrame: 26, endFrame: 62 },
    ]);
  });

  it("trims a span that runs past the end of the scene", () => {
    // Not defensive dressing: the manifest rounds seconds*fps while the spans
    // come from walking the decoded audio, so the last span legitimately
    // overshoots. Without this every caller writes the same Math.min and the
    // one who forgets gets a validation throw at render time.
    expect(segmentsFromSpans([[80, 105]], 100)).toEqual([{ startFrame: 80, endFrame: 100 }]);
  });

  it("drops a span entirely beyond the scene", () => {
    expect(
      segmentsFromSpans(
        [
          [0, 10],
          [120, 150],
        ],
        100,
      ),
    ).toEqual([{ startFrame: 0, endFrame: 10 }]);
  });

  it("leaves real silence between the spans", () => {
    // The property the pause-centre path could not deliver. If this ever reads
    // 0% again, the mouth is back to talking through the pauses.
    const segments = segmentsFromSpans(
      [
        [0, 20],
        [40, 60],
      ],
      100,
    );
    const cues = buildMouthCues("the lamp burned low", segments, 100);
    const resting = cues.filter((c) => c.viseme === REST).reduce((a, c) => a + c.frames, 0);
    expect(resting).toBe(60);
  });
});

describe("segmentsFromPauses inverts the existing pause measurement", () => {
  it("tiles the scene with no silence, which is why it is a fallback", () => {
    // Pinning the known flaw rather than leaving it in a comment. A centre has
    // no width, so the runs between centres leave nowhere to rest. Measured
    // across all of Episode 3 this gave 0% rest for seven minutes.
    const segments = segmentsFromPauses([50, 120], 200);
    const cues = buildMouthCues("the lamp burned low in the dark", segments, 200);
    const resting = cues.filter((c) => c.viseme === REST).reduce((a, c) => a + c.frames, 0);
    expect(resting).toBe(0);
  });

  it("turns pause centres into the spans between them", () => {
    expect(segmentsFromPauses([50, 120], 200)).toEqual([
      { startFrame: 0, endFrame: 50 },
      { startFrame: 50, endFrame: 120 },
      { startFrame: 120, endFrame: 200 },
    ]);
  });

  it("covers the whole scene with no gaps", () => {
    const segments = segmentsFromPauses([10, 40, 41, 90], 120);
    expect(segments[0].startFrame).toBe(0);
    expect(segments[segments.length - 1].endFrame).toBe(120);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].startFrame).toBe(segments[i - 1].endFrame);
    }
  });

  it("ignores pauses outside the scene", () => {
    // A stale pause table measured against longer narration. Better to drop
    // the impossible ones than to build a segment that fails validation later.
    expect(segmentsFromPauses([-5, 50, 500], 100)).toEqual([
      { startFrame: 0, endFrame: 50 },
      { startFrame: 50, endFrame: 100 },
    ]);
  });

  it("gives one segment when there are no pauses at all", () => {
    expect(segmentsFromPauses([], 90)).toEqual([{ startFrame: 0, endFrame: 90 }]);
  });

  it("produces segments buildMouthCues accepts", () => {
    // The two halves have to actually compose — this is the join where an
    // off-by-one would surface as a validation throw at render time.
    const segments = segmentsFromPauses([30, 75, 140], 200);
    expect(coverage(buildMouthCues("the lamp burned in the dark", segments, 200))).toBe(200);
  });
});

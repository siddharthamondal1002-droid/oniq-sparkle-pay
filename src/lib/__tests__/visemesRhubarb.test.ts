import { describe, expect, it } from "vitest";
import { cuesFromRhubarb, visemeAtFrame, type RhubarbCue } from "@/lib/visemes";

/**
 * The Rhubarb converter is the measured half of the mouth: real audio in,
 * frame-accurate shapes out. Its invariants are the ones the renderer trusts —
 * full coverage, no overlaps, no flickers — and a violation would show up on
 * screen as a strobing or frozen mouth, which no other test would catch.
 */
const cue = (start: number, end: number, value: string): RhubarbCue => ({ start, end, value });

describe("cuesFromRhubarb", () => {
  it("converts seconds to frames and fills silence with rest", () => {
    const track = cuesFromRhubarb([cue(0.5, 1.0, "D")], 30, 60);
    expect(track).toEqual([
      { startFrame: 0, frames: 15, viseme: "X" },
      { startFrame: 15, frames: 15, viseme: "D" },
      { startFrame: 30, frames: 30, viseme: "X" },
    ]);
  });

  it("always covers the whole shot exactly", () => {
    for (const frames of [1, 2, 7, 30, 301]) {
      const track = cuesFromRhubarb([cue(0.1, 0.4, "B"), cue(0.4, 0.9, "E")], 30, frames);
      expect(track.reduce((s, c) => s + c.frames, 0)).toBe(frames);
      for (let i = 1; i < track.length; i++) {
        expect(track[i].startFrame).toBe(track[i - 1].startFrame + track[i - 1].frames);
      }
    }
  });

  it("degrades an empty cue list to a resting mouth, never a throw", () => {
    expect(cuesFromRhubarb([], 30, 90)).toEqual([{ startFrame: 0, frames: 90, viseme: "X" }]);
  });

  it("clamps cues that overrun the shot", () => {
    const track = cuesFromRhubarb([cue(2.0, 99.0, "C")], 30, 90);
    expect(track.reduce((s, c) => s + c.frames, 0)).toBe(90);
    expect(visemeAtFrame(track, 89)).toBe("C");
  });

  it("drops cues entirely outside the shot", () => {
    const track = cuesFromRhubarb([cue(10, 11, "D")], 30, 60);
    expect(track).toEqual([{ startFrame: 0, frames: 60, viseme: "X" }]);
  });

  it("maps an unknown shape to a neutral consonant rather than crashing", () => {
    const track = cuesFromRhubarb([cue(0, 2, "Q")], 30, 60);
    expect(track[0].viseme).toBe("B");
  });

  it("absorbs sub-hold flickers instead of strobing", () => {
    // One frame of E between two Bs: below the 2-frame hold, must vanish.
    const track = cuesFromRhubarb(
      [cue(0, 0.5, "B"), cue(0.5, 0.5333, "E"), cue(0.5333, 1.0, "B")],
      30,
      30,
    );
    expect(track).toEqual([{ startFrame: 0, frames: 30, viseme: "B" }]);
  });

  it("absorbs a too-short FIRST cue forward", () => {
    const track = cuesFromRhubarb([cue(0, 0.0333, "D"), cue(0.0333, 1.0, "B")], 30, 30);
    expect(track.reduce((s, c) => s + c.frames, 0)).toBe(30);
    expect(track[0].startFrame).toBe(0);
    expect(track[0].viseme).toBe("B");
  });

  it("resolves rounding overlaps by letting the later cue yield", () => {
    // 0.49 and 0.51 both round to frame 15 at 30fps.
    const track = cuesFromRhubarb([cue(0, 0.51, "B"), cue(0.49, 1.0, "E")], 30, 30);
    expect(track.reduce((s, c) => s + c.frames, 0)).toBe(30);
    expect(visemeAtFrame(track, 14)).toBe("B");
    expect(visemeAtFrame(track, 20)).toBe("E");
  });

  it("survives a real Rhubarb-shaped result", () => {
    // Verbatim shape of an actual getLipSync() run in this container.
    const real: RhubarbCue[] = [
      cue(0, 0.34, "X"),
      cue(0.34, 0.55, "B"),
      cue(0.55, 0.67, "X"),
      cue(0.67, 0.9, "B"),
      cue(0.9, 1.03, "X"),
      cue(1.03, 1.22, "B"),
      cue(1.22, 1.35, "X"),
      cue(1.35, 1.54, "B"),
    ];
    const frames = Math.round(3.0 * 30);
    const track = cuesFromRhubarb(real, 30, frames);
    expect(track.reduce((s, c) => s + c.frames, 0)).toBe(frames);
    expect(track.every((c) => c.frames >= 2)).toBe(true);
    expect(visemeAtFrame(track, 12)).toBe("B");
  });

  it("rejects a non-count frame total loudly", () => {
    expect(() => cuesFromRhubarb([], 30, 0)).toThrow(/frame count/);
    expect(() => cuesFromRhubarb([], 0, 30)).toThrow(/rate/);
  });
});

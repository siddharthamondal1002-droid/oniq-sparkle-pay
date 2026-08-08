/**
 * Track A1 — the windowing arithmetic.
 *
 * Real execution, not source assertions: this is pure and the interesting
 * cases are off-by-ones at the boundary. An orphaned day separator or a
 * reply-jump that widens by one row too few are both silent — the screen just
 * looks slightly wrong, or a button quietly does nothing.
 *
 * What these do NOT establish is that the app is faster. That is a claim about
 * frames on a real mid-range phone and it stays unverified until somebody
 * measures it there. What is verified is that fewer rows are handed to React,
 * which is the mechanism the speed-up would come from.
 */
import { describe, expect, it } from "vitest";
import { WINDOW_STEP, windowRows, windowSizeToReveal } from "@/lib/chat/messageWindow";

type R = { kind: string; key: string };
const msg = (n: number): R => ({ kind: "msg", key: `m${n}` });
const day = (n: number): R => ({ kind: "day", key: `d${n}` });
const list = (n: number): R[] => Array.from({ length: n }, (_, i) => msg(i));

describe("the window keeps the tail", () => {
  it("returns everything when the list is short", () => {
    const rows = list(10);
    expect(windowRows(rows, 60)).toEqual({ rows, hidden: 0 });
  });

  it("returns everything at exactly the window size", () => {
    const rows = list(60);
    expect(windowRows(rows, 60).hidden).toBe(0);
    expect(windowRows(rows, 60).rows).toHaveLength(60);
  });

  it("keeps the LAST n, not the first", () => {
    // Chat opens at the bottom. Keeping the first n would show the oldest
    // messages and hide the conversation the user came to read.
    const out = windowRows(list(100), 10);
    expect(out.rows).toHaveLength(10);
    expect(out.rows[0].key).toBe("m90");
    expect(out.rows.at(-1)!.key).toBe("m99");
    expect(out.hidden).toBe(90);
  });

  it("reports hidden and shown adding up to the whole list", () => {
    for (const [total, size] of [
      [100, 10],
      [61, 60],
      [200, 60],
      [7, 3],
    ]) {
      const out = windowRows(list(total), size);
      expect(out.rows.length + out.hidden, `${total}/${size}`).toBe(total);
    }
  });

  it("handles a zero or negative window without crashing", () => {
    expect(windowRows(list(5), 0)).toEqual({ rows: [], hidden: 5 });
    expect(windowRows(list(5), -1)).toEqual({ rows: [], hidden: 5 });
  });

  it("handles an empty list", () => {
    expect(windowRows([], 60)).toEqual({ rows: [], hidden: 0 });
  });
});

describe("a day separator is never orphaned", () => {
  it("pulls in the separator sitting just above the cut", () => {
    // Cutting between a "Yesterday" header and its messages leaves the first
    // thing on screen dateless, which reads as a rendering bug rather than as
    // the top of a window.
    const rows = [msg(0), msg(1), day(1), msg(2), msg(3)];
    const out = windowRows(rows, 2);
    // Naively the last 2 are [m2, m3]; the separator is pulled in too.
    expect(out.rows.map((r) => r.key)).toEqual(["d1", "m2", "m3"]);
    expect(out.hidden).toBe(2);
  });

  it("does not pull one in when the cut already starts on a separator", () => {
    const rows = [msg(0), day(1), msg(1), msg(2)];
    const out = windowRows(rows, 3);
    expect(out.rows.map((r) => r.key)).toEqual(["d1", "m1", "m2"]);
    expect(out.hidden).toBe(1);
  });

  it("does not run off the start of the list", () => {
    const rows = [day(0), msg(0), msg(1)];
    const out = windowRows(rows, 2);
    expect(out.rows.map((r) => r.key)).toEqual(["d0", "m0", "m1"]);
    expect(out.hidden).toBe(0);
  });

  it("still balances hidden against shown after pulling one in", () => {
    const rows = [msg(0), msg(1), day(1), msg(2), msg(3)];
    const out = windowRows(rows, 2);
    expect(out.rows.length + out.hidden).toBe(rows.length);
  });
});

describe("reply-jump can reach a hidden message", () => {
  it("widens enough to include the target", () => {
    // 100 rows, window of 10, target at index 3. Without widening the button
    // silently does nothing, which reads as broken.
    const rows = list(100);
    const size = windowSizeToReveal(rows, 3, 10);
    expect(size).toBeGreaterThanOrEqual(100 - 3);
    expect(windowRows(rows, size).rows.some((r) => r.key === "m3")).toBe(true);
  });

  it("leaves context above the target rather than pinning it to the edge", () => {
    const rows = list(100);
    const size = windowSizeToReveal(rows, 50, 10);
    const shown = windowRows(rows, size).rows;
    const at = shown.findIndex((r) => r.key === "m50");
    expect(at).toBeGreaterThan(0);
  });

  it("never shrinks an already-wider window", () => {
    // Jumping to a recent message must not throw away rows the user already
    // expanded to see.
    expect(windowSizeToReveal(list(100), 98, 80)).toBe(80);
  });

  it("is a no-op for an index that is not in the list", () => {
    expect(windowSizeToReveal(list(10), -1, 60)).toBe(60);
    expect(windowSizeToReveal(list(10), 99, 60)).toBe(60);
  });

  it("reveals the very first row when asked", () => {
    const rows = list(200);
    const size = windowSizeToReveal(rows, 0, WINDOW_STEP);
    expect(windowRows(rows, size).rows[0].key).toBe("m0");
    expect(windowRows(rows, size).hidden).toBe(0);
  });
});

describe("the default keeps the DOM small", () => {
  it("mounts far fewer rows than the 200-message server cap", () => {
    // The server fetch is .limit(200). This is the number that actually
    // reaches React, and it is the whole point of the change.
    expect(WINDOW_STEP).toBeLessThan(200);
    expect(windowRows(list(200), WINDOW_STEP).rows.length).toBe(WINDOW_STEP);
  });

  it("is big enough to fill a phone screen several times over", () => {
    // Too small and the user hits "load earlier" immediately, which is worse
    // than the problem being solved.
    expect(WINDOW_STEP).toBeGreaterThanOrEqual(40);
  });
});

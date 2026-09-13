import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startVisiblePolling } from "../visiblePolling";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("startVisiblePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately and on each interval while visible", async () => {
    const tick = vi.fn();
    const stop = startVisiblePolling(tick, 6000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(12000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("pauses in the background and resumes with one foreground tick", async () => {
    const tick = vi.fn();
    const stop = startVisiblePolling(tick, 6000);
    expect(tick).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(12000);
    expect(tick).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("does not overlap an async tick already in flight", async () => {
    let release = () => {};
    const tick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const stop = startVisiblePolling(tick, 6000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(18000);
    expect(tick).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(6000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startVisiblePolling } from "../visiblePolling";

type FakeDocument = EventTarget & {
  visibilityState: DocumentVisibilityState;
  addEventListener: EventTarget["addEventListener"];
  removeEventListener: EventTarget["removeEventListener"];
  dispatchEvent: EventTarget["dispatchEvent"];
};

function makeFakeDocument(): FakeDocument {
  const target = new EventTarget() as FakeDocument;
  target.visibilityState = "visible";
  return target;
}

describe("startVisiblePolling", () => {
  let fakeDocument: FakeDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    fakeDocument = makeFakeDocument();
    vi.stubGlobal("document", fakeDocument);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function setVisibility(state: DocumentVisibilityState) {
    fakeDocument.visibilityState = state;
    fakeDocument.dispatchEvent(new Event("visibilitychange"));
  }

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

  it("stops itself when a tick reports the watched thing has settled", async () => {
    const tick = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const stop = startVisiblePolling(tick, 6000);
    await vi.advanceTimersByTimeAsync(6000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(tick).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps polling after a failed tick", async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(undefined);
    const stop = startVisiblePolling(tick, 6000);
    await vi.advanceTimersByTimeAsync(12000);
    expect(tick).toHaveBeenCalledTimes(3);
    stop();
  });

  it("can defer the first read to one interval away", async () => {
    const tick = vi.fn();
    const stop = startVisiblePolling(tick, 6000, false);
    expect(tick).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(tick).toHaveBeenCalledTimes(1);
    stop();
  });
});

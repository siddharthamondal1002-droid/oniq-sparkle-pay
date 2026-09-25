import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startVisiblePolling } from "../visiblePolling";

describe("visible status polling", () => {
  let doc: EventTarget & { visibilityState: string };
  let stop: (() => void) | undefined;
  const visibility = (value: string) => {
    doc.visibilityState = value;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  beforeEach(() => {
    vi.useFakeTimers();
    doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("document", doc);
  });
  afterEach(() => {
    stop?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("does no background reads and refreshes immediately on return", async () => {
    const read = vi.fn(async () => {});
    stop = startVisiblePolling(read, 6000);
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(2);
    visibility("hidden");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
    visibility("visible");
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("does not overlap a slow read, including foreground events", async () => {
    let resolve!: () => void;
    const read = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    stop = startVisiblePolling(read, 6000);
    await vi.advanceTimersByTimeAsync(18_000);
    visibility("hidden");
    visibility("visible");
    expect(read).toHaveBeenCalledTimes(1);
    resolve();
    await vi.advanceTimersByTimeAsync(6000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("retries failed reads without leaving an unhandled rejection", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(false);
    stop = startVisiblePolling(read, 6000);
    await vi.advanceTimersByTimeAsync(60_000);
    visibility("hidden");
    visibility("visible");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("cleanup during a request prevents any later scheduling", async () => {
    let resolve!: () => void;
    const read = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    stop = startVisiblePolling(read, 6000);
    stop();
    resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    visibility("visible");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("can defer the first read and starts hidden without a request", async () => {
    const read = vi.fn(async () => {});
    visibility("hidden");
    stop = startVisiblePolling(read, 6000, false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).not.toHaveBeenCalled();
    visibility("visible");
    expect(read).toHaveBeenCalledTimes(1);
  });
});

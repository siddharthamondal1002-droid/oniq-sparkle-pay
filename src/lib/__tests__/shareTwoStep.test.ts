/**
 * The two-step web share.
 *
 * The single-step version could not work and said so in its own comment: a
 * File is required before `navigator.share` may be called, obtaining the bytes
 * takes an await, and an await ends the transient activation the sheet needs.
 * The fix is structural — prepare on one tap, share on the next — so what these
 * assertions protect is the ORDER, not a message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const shareMock = vi.fn();
const canShareMock = vi.fn(() => true);

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isPluginAvailable: () => false,
    isNativePlatform: () => false,
    getPlatform: () => "web",
  },
}));

import { prepareVideoShare, shareReadyFile, lastShareDiagnostics } from "@/lib/share";

const PAYLOAD = { title: "t", text: "x", url: "https://example.test" };

beforeEach(() => {
  shareMock.mockReset();
  canShareMock.mockReset().mockReturnValue(true);
  Object.assign(navigator, { share: shareMock, canShare: canShareMock });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Blob([new Uint8Array(8)], { type: "video/mp4" }))),
  );
  vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("step one prepares without sharing", () => {
  it("returns the file and never opens the sheet", async () => {
    const r = await prepareVideoShare("https://x/f.mp4", "f.mp4", PAYLOAD);
    expect(r.kind).toBe("ready");
    // THE WHOLE POINT: no share happened during the await.
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("refuses before downloading when files cannot be shared", async () => {
    canShareMock.mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const r = await prepareVideoShare("https://x/f.mp4", "f.mp4", PAYLOAD);
    expect(r).toEqual({ kind: "done", outcome: "unsupported" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a dead URL as a failure, not as a ready file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const r = await prepareVideoShare("https://x/f.mp4", "f.mp4", PAYLOAD);
    expect(r).toEqual({ kind: "done", outcome: "failed" });
    expect(lastShareDiagnostics()?.error).toBe("http 404");
  });
});

describe("step two shares with nothing awaited in front of it", () => {
  it("calls navigator.share synchronously", () => {
    shareMock.mockReturnValue(new Promise(() => {}));
    const file = new File([new Uint8Array(4)], "f.mp4", { type: "video/mp4" });
    void shareReadyFile(file, PAYLOAD);
    // Called during the same tick as the click — the activation is intact.
    expect(shareMock).toHaveBeenCalledTimes(1);
  });

  it("a cancel NEVER becomes a download", async () => {
    shareMock.mockRejectedValue(new DOMException("no", "AbortError"));
    const clicks = vi.fn();
    vi.spyOn(document.body, "appendChild").mockImplementation(((n: Node) => {
      clicks();
      return n;
    }) as typeof document.body.appendChild);
    const out = await shareReadyFile(new File([], "f.mp4"), PAYLOAD);
    expect(out).toBe("cancelled");
    expect(clicks).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("a platform refusal offers the bytes and claims only that a download started", async () => {
    shareMock.mockRejectedValue(new DOMException("nope", "NotAllowedError"));
    const out = await shareReadyFile(new File([], "f.mp4"), PAYLOAD);
    expect(out).toBe("download-started");
    expect(lastShareDiagnostics()?.stage).toBe("web-share-refused-download-requested");
  });

  it("an unrelated throw stays a failure", async () => {
    shareMock.mockRejectedValue(new Error("boom"));
    expect(await shareReadyFile(new File([], "f.mp4"), PAYLOAD)).toBe("failed");
  });

  it("a completed share says so", async () => {
    shareMock.mockResolvedValue(undefined);
    expect(await shareReadyFile(new File([], "f.mp4"), PAYLOAD)).toBe("shared");
  });
});

/**
 * The two recorded `share-video` failures, reproduced — and the two things
 * this module is now careful NOT to claim about them.
 *
 * BOTH reports (2026-09-04 14:18/14:32, 2026-09-11 13:43/13:44) carry the
 * identical detail:
 *
 *   {"platform":"web","native":false,"sharePlugin":false,"filesystemPlugin":false,
 *    "webShare":true,"webShareFiles":true,"stage":"web-threw",
 *    "error":"The request is not allowed by the user agent or the platform in
 *             the current context, possibly because the user denied permission."}
 *
 * `webShare:true` AND `webShareFiles:true` in the same row is what makes this
 * worth a branch: the browser can share files and refused anyway.
 *
 * WHAT IS NOT ASSERTED, deliberately. The first fix named the stage
 * "web-activation-lost", which states a CAUSE. A lost transient activation is
 * the leading candidate — the multi-megabyte fetch certainly spends it — but a
 * `web-share` Permissions-Policy, a WebView's own rules and a plain user-agent
 * refusal raise the same NotAllowedError with the same message, and nothing
 * reachable from the browser separates them. The stage records WHAT HAPPENED
 * (the share was refused, a download was requested) and no more.
 *
 * Nor is a SAVE asserted. `a.click()` requests a download; it cannot observe a
 * written file, a dismissed prompt or a download manager's refusal. Hence
 * "download-started".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastShareDiagnostics, shareVideoFile } from "../share";

const PAYLOAD = { title: "My ONIQ Story", text: "Made on ONIQ", url: "https://oniqhub.com" };
const MEASURED_NOT_ALLOWED =
  "The request is not allowed by the user agent or the platform in the current context, " +
  "possibly because the user denied permission.";

let clicked: number;
let fetched: number;

function stubBrowser(shareImpl: () => Promise<void>, canShare: () => boolean = () => true) {
  clicked = 0;
  fetched = 0;
  vi.stubGlobal("fetch", async () => {
    fetched++;
    return new Response(new Blob([new Uint8Array([1, 2, 3])]));
  });
  vi.stubGlobal("navigator", {
    share: shareImpl,
    canShare,
    userAgent: "test",
  } as unknown as Navigator);
  // This repo's vitest environment is "node", so there is no DOM to spy on —
  // the anchor is stubbed outright. Counting the CLICK rather than reading a
  // return value matters: the fallback could report a download without ever
  // handing the bytes over, and that is precisely the failure being fixed.
  const anchor = { href: "", download: "", rel: "", click: () => void clicked++, remove() {} };
  vi.stubGlobal("document", {
    createElement: (tag: string) => (tag === "a" ? anchor : {}),
    body: { appendChild: () => undefined },
  });
  vi.stubGlobal("URL", {
    createObjectURL: () => "blob:stub",
    revokeObjectURL: () => undefined,
  });
}

beforeEach(() => {
  clicked = 0;
  fetched = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web share refused with the film already in hand", () => {
  it("requests a download rather than losing the film, and says only that", async () => {
    stubBrowser(async () => {
      throw new DOMException(MEASURED_NOT_ALLOWED, "NotAllowedError");
    });

    const outcome = await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD);

    expect(outcome).toBe("download-started");
    expect(clicked).toBe(1);
    const stage = lastShareDiagnostics()?.stage;
    expect(stage).toBe("web-share-refused-download-requested");
    // The retired name asserted a diagnosis this side cannot make.
    expect(stage).not.toBe("web-activation-lost");
  });

  it("never reports a completed save, because it cannot observe one", async () => {
    stubBrowser(async () => {
      throw new DOMException(MEASURED_NOT_ALLOWED, "NotAllowedError");
    });

    const outcome = await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD);

    expect(outcome).not.toBe("downloaded");
    expect(lastShareDiagnostics()?.error).toMatch(/download was requested/i);
  });

  it("a cancelled sheet is never turned into a download", async () => {
    stubBrowser(async () => {
      throw new DOMException("Share canceled", "AbortError");
    });

    const outcome = await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD);

    expect(outcome).toBe("cancelled");
    // The whole point: the person said no. Handing them the file anyway is a
    // worse bug than the one being fixed.
    expect(clicked).toBe(0);
    expect(lastShareDiagnostics()?.stage).toBe("web-cancelled");
  });

  it("an unrelated throw is still a failure, so the fallback hides nothing", async () => {
    stubBrowser(async () => {
      throw new TypeError("network died mid-share");
    });

    const outcome = await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD);

    expect(outcome).toBe("failed");
    expect(clicked).toBe(0);
    expect(lastShareDiagnostics()?.stage).toBe("web-threw");
  });

  it("a successful share does not download a second copy", async () => {
    stubBrowser(async () => undefined);

    expect(await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD)).toBe("shared");
    expect(clicked).toBe(0);
  });
});

describe("the download that is not spent", () => {
  it("a browser that cannot share files is refused BEFORE the film is fetched", async () => {
    // The old order downloaded megabytes and only then asked the question it
    // could have asked for nothing.
    stubBrowser(async () => undefined, () => false);

    expect(await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD)).toBe("unsupported");
    expect(fetched).toBe(0);
    expect(lastShareDiagnostics()?.stage).toBe("web-cannot-share-files");
  });
});

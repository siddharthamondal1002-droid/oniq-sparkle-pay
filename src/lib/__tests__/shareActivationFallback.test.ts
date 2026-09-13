/**


 * The two recorded `share-video` failures, reproduced and fixed.
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
 * diagnosable: the browser can share files and refused anyway. That is
 * `NotAllowedError` — Web Share needs transient user activation, and the
 * multi-megabyte `await fetch` of the film spends it before the sheet is asked
 * for. Filed as a generic failure it is unactionable, and the person loses a
 * film that was already downloaded into memory.
 *
 * These pin the behaviour, not the wording:
 *   - a NotAllowedError hands the bytes over as a download and says so;
 *   - a genuine cancel NEVER becomes a fallback attempt, which is this
 *     module's oldest rule and the thing a download fallback is most likely
 *     to break;
 *   - an unrelated throw is still a plain failure, so the fallback cannot
 *     swallow a real fault.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lastShareDiagnostics, shareVideoFile } from "../share";

const PAYLOAD = { title: "My ONIQ Story", text: "Made on ONIQ", url: "https://oniqhub.com" };
const MEASURED_NOT_ALLOWED =
  "The request is not allowed by the user agent or the platform in the current context, " +
  "possibly because the user denied permission.";

let clicked: number;

function stubBrowser(shareImpl: () => Promise<void>) {
  clicked = 0;
  vi.stubGlobal("fetch", async () => new Response(new Blob([new Uint8Array([1, 2, 3])])));
  vi.stubGlobal("navigator", {
    share: shareImpl,
    canShare: () => true,
    userAgent: "test",
  } as unknown as Navigator);
  // The anchor download is the fallback under test; count the click rather
  // than asserting on a return value the fallback could fake.
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = realCreate(tag);
    if (tag === "a") (el as HTMLAnchorElement).click = () => void clicked++;
    return el;
  });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: () => "blob:stub",
    revokeObjectURL: () => undefined,
  });
}

beforeEach(() => {
  clicked = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web share when the activation window is gone", () => {
  it("saves the film instead of losing it, and records its own stage", async () => {
    stubBrowser(async () => {
      throw new DOMException(MEASURED_NOT_ALLOWED, "NotAllowedError");
    });

    const outcome = await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD);

    expect(outcome).toBe("downloaded");
    expect(clicked).toBe(1);
    // NOT "web-threw". A distinct stage is what lets the next reader count
    // activation losses without re-deriving them from an error string.
    expect(lastShareDiagnostics().stage).toBe("web-activation-lost");
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
    expect(lastShareDiagnostics().stage).toBe("web-cancelled");
  });

  it("an unrelated throw is still a failure, so the fallback hides nothing", async () => {
    stubBrowser(async () => {
      throw new TypeError("network died mid-share");
    });

    const outcome = await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD);

    expect(outcome).toBe("failed");
    expect(clicked).toBe(0);
    expect(lastShareDiagnostics().stage).toBe("web-threw");
  });

  it("a successful share does not download a second copy", async () => {
    stubBrowser(async () => undefined);

    expect(await shareVideoFile("https://x/f.mp4", "f.mp4", PAYLOAD)).toBe("shared");
    expect(clicked).toBe(0);
  });
});

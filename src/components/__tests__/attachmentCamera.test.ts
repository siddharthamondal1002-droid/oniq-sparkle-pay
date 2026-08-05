/**
 * The Camera tile must actually open the camera.
 *
 * THE BUG THIS PINS
 *
 * AttachmentSheet set the `capture` attribute only when
 * `context.isNative === false`. On the Android build isNative is true, so the
 * attribute was REMOVED and the camera options fell through to the ordinary
 * file picker: Camera and Gallery opened the same screen, and the camera never
 * opened at all.
 *
 * The condition reads like it was written expecting a native plugin path.
 * There is none — @capacitor/camera is not a dependency — and Android's
 * WebView honours `capture` exactly as Chrome does. So the attribute must be
 * set on both platforms, unconditionally.
 *
 * These assert the source rather than the DOM because the failure was a
 * platform branch, and a jsdom test would have run in exactly the one
 * environment where the old code happened to work.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const sheet = readFileSync(join(ROOT, "src/components/attach/AttachmentSheet.tsx"), "utf8");
const chat = readFileSync(
  join(ROOT, "src/routes/_authenticated/app.chat.$conversationId.tsx"),
  "utf8",
);

/** Code only — a comment describing the old bug must not read as the bug. */
function codeOf(text: string): string {
  return text
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");
}

const sheetCode = codeOf(sheet);

describe("the camera tile opens the camera", () => {
  it("sets capture for the camera options", () => {
    expect(sheetCode).toMatch(/setAttribute\(\s*["']capture["']\s*,\s*["']environment["']\s*\)/);
  });

  it("never conditions capture on the platform", () => {
    // The exact shape of the bug: any isNative test guarding the capture
    // branch. Camera works the same way in the WebView and the browser.
    const branch = sheetCode.slice(
      sheetCode.indexOf("wantsCamera"),
      sheetCode.indexOf("input.click()"),
    );
    expect(branch, "capture is gated on platform again").not.toMatch(/isNative/);
  });

  it("treats camera and gallery as different code paths", () => {
    // Gallery must NOT get capture, or picking an existing photo becomes
    // impossible — the mirror image of the reported bug.
    expect(sheetCode).toMatch(/removeAttribute\(\s*["']capture["']\s*\)/);
  });

  it("never combines capture with multiple", () => {
    // Undefined behaviour: some Android builds silently fall back to the
    // picker, which is indistinguishable from the original bug.
    expect(sheetCode).toMatch(/multiple\s*=\s*wantsCamera\s*\?\s*false/);
  });

  it("still distinguishes the camera options downstream", () => {
    // The sheet reporting id "camera" is only useful if the consumer keeps
    // acting on it.
    expect(chat).toMatch(/option\.id === "camera-video"/);
    expect(chat).toMatch(/option\.id === "camera"/);
  });
});

describe("no dead picker wiring is left to mislead", () => {
  it("the chat route has no unreachable hidden file inputs", () => {
    // Five hidden inputs sat in the chat route, two with capture set, and
    // nothing ever clicked any of them. They made the camera look wired while
    // it was broken.
    const code = codeOf(chat);
    for (const ref of [
      "cameraInputRef",
      "cameraVideoRef",
      "fileInputRef",
      "videoInputRef",
      "anyFileInputRef",
    ]) {
      expect(code, `${ref} is back — is anything actually clicking it?`).not.toContain(ref);
    }
  });

  it("the AttachmentSheet owns the only file input", () => {
    expect(sheetCode).toMatch(/ref=\{inputRef\}/);
    expect(sheetCode).toMatch(/input\.click\(\)/);
  });
});

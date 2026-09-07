/**
 * ON NATIVE, `<a download>` IS A NO-OP — SO IT MUST NEVER BE THE FALLBACK.
 *
 * MediaSaverPlugin.java already records what an anchor download does inside a
 * Capacitor WebView, in its own words: "no DownloadListener is attached, so the
 * click is swallowed silently". It was written because that behaviour once
 * destroyed a film — the web layer reported success and told the server to
 * purge the only copy.
 *
 * `deliverFile` and `shareFile` kept that dead anchor as their fallback for
 * everything ELSE — pictures, songs, voice clips. So on Android, whenever the
 * native share path was unavailable or threw, the Download button ran the
 * no-op, `webDeliver` returned "downloaded", and the caller showed no error.
 * A button that does nothing and says nothing.
 *
 * These assertions read the source rather than run it, because the branch only
 * exists on a real device: `Capacitor.isNativePlatform()` is false in vitest,
 * so a behavioural test would exercise the WEB path and pass no matter what
 * the native one did. That is the same trap as `phoneLoginVisible`
 * short-circuiting on a flag — test the part the environment cannot reach.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** Every comment above quotes the identifiers below. Prose goes first. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const SAVE = codeOnly(readFileSync(join(ROOT, "src/lib/saveFile.ts"), "utf8"));
const ACTIONS = codeOnly(
  readFileSync(join(ROOT, "src/components/oniq/OniqResultActions.tsx"), "utf8"),
);

/** The body of one exported function, up to the next top-level close. */
function body(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} went missing`).toBeGreaterThan(-1);
  const j = src.indexOf("\n}", i);
  return src.slice(i, j);
}

describe("a failed native delivery is reported, never swallowed", () => {
  for (const fn of ["deliverFile", "shareFile"]) {
    it(`${fn} does not reach the web anchor on native`, () => {
      const b = body(SAVE, fn);
      // The native branch must come BEFORE any webDeliver call, and must end
      // in a throw — otherwise the anchor runs and "succeeds".
      const guard = b.indexOf("Capacitor.isNativePlatform()");
      const web = b.indexOf("webDeliver(");
      expect(guard, `${fn} lost its native guard`).toBeGreaterThan(-1);
      expect(guard, `${fn} falls to the anchor before checking native`).toBeLessThan(web);
      expect(b, `${fn} stopped reporting a total failure`).toContain("throw new Error");
    });
  }

  it("the browser fallback exists and is native-only", () => {
    // @capacitor/browser is already a dependency, so Chrome's own downloader
    // is reachable without any new native code or a Play release.
    expect(SAVE).toContain("nativeBrowserDownload");
    expect(SAVE).toContain('import("@capacitor/browser")');
    const b = SAVE.slice(SAVE.indexOf("async function nativeBrowserDownload"));
    expect(b.slice(0, 300), "the fallback would fire on the web too").toContain(
      "Capacitor.isNativePlatform()",
    );
  });

  it("the caller hands over the URL, or there is no second chance", () => {
    expect(ACTIONS).toContain("deliverFile(filename, mime, blob, url)");
    expect(ACTIONS).toContain("shareFile(filename, mime, blob, { title }, url)");
  });
});

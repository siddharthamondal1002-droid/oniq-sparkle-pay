/**
 * The Google Fonts stylesheet must stay OFF the critical render path.
 *
 * THE WEIGHT THIS PINS
 *
 * The per-script Baloo (Indic) + Noto (CJK/Arabic/Sinhala/Thai/Urdu) faces are
 * loaded from fonts.googleapis.com. Measured, that stylesheet is ~253 KB
 * gzipped / ~1 MB parsed across 1,206 @font-face rules, and it is cross-origin.
 * As a plain `rel="stylesheet"` it was render-blocking — every user, including
 * the Latin/English initial `lang="en"` paint that renders NONE of these
 * glyphs, waited on it before first paint.
 *
 * The fix loads it with media="print" (a print sheet never blocks the screen
 * render) and flips it to "all" in a RootComponent mount effect, so the faces
 * still apply after hydration. Each :lang() rule in styles.css already lists a
 * system-ui fallback and the URL keeps display=swap, so nothing renders worse
 * in the pre-flip window.
 *
 * Source assertion (the repo's style for structural guarantees): a later edit
 * dropping media="print" or the flip effect would silently restore the
 * render-blocking request while every runtime test still passed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = readFileSync(join(process.cwd(), "src/routes/__root.tsx"), "utf8");

describe("Google Fonts deferral", () => {
  it("loads the fonts.googleapis.com stylesheet with media=print (non-blocking)", () => {
    // The stylesheet link object must carry media: "print".
    const block = root.slice(
      root.indexOf("fonts.googleapis.com/css2") - 400,
      root.indexOf("fonts.googleapis.com/css2"),
    );
    expect(block).toMatch(/media:\s*"print"/);
  });

  it("keeps display=swap so the fallback→web-font swap stays graceful", () => {
    expect(root).toContain("display=swap");
  });

  it("flips the deferred sheet to media=all after mount", () => {
    expect(root).toMatch(/link\[rel="stylesheet"\]\[href\*="fonts\.googleapis\.com"\]/);
    expect(root).toMatch(/\.media\s*=\s*"all"/);
  });
});

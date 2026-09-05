/**
 * NOTHING MAY DRAG THE APP SIDEWAYS.
 *
 * REPORTED 2026-09-05, "screen displacement", with three screenshots. They are
 * measurable, and the measurement is what identified the cause: the OS status
 * bar occupies [42,1028] in ALL THREE, so nothing about the capture changed,
 * while the app header moves from [63,1076] to [8,1021]. The whole app —
 * header, content and bottom nav — is translated left by 55 device px (~20 CSS
 * px) with no re-layout at all, since both spans are exactly 1013px wide. The
 * order of the shots names the gesture: rail at rest, rail scrolled, app
 * displaced.
 *
 * WHAT IT WAS NOT. Not an overflowing document. Measured headless against the
 * built stylesheet at 360, 393 and 411 CSS px, `document.body.scrollWidth`
 * equals the body width exactly — the `-mx-5 … px-5` full-bleed on the rails
 * is balanced and contributes nothing. That is also why the existing
 * `html, body { overflow-x: clip }` did not prevent it: clip stops the
 * document being WIDER, and the document was never wider.
 *
 * WHAT IT WAS. `overscroll-behavior` governs chaining OUT OF the element it is
 * set on. The guard written on 2026-08-18 sets it on `html, body`, which stops
 * the DOCUMENT handing a gesture to the native view — and says nothing about a
 * rail handing one to the document. A swipe that reached the end of a rail
 * carried on into whatever would take it.
 *
 * The rule asserted here is deliberately general rather than a list of the two
 * utilities fixed: ANY utility that scrolls horizontally must contain its
 * overscroll. The next rail added to this codebase is the one this is for.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

/** Every `@utility name { … }` block, brace-matched so nesting survives. */
function utilities(css: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /@utility\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    out.push({ name: m[1], body: css.slice(re.lastIndex, i - 1) });
  }
  return out;
}

const UTILS = utilities(CSS);

describe("a horizontal scroller may not hand its gesture to the app", () => {
  it("finds the utilities at all, so this suite cannot pass vacuously", () => {
    expect(UTILS.length).toBeGreaterThan(5);
    expect(UTILS.map((u) => u.name)).toEqual(expect.arrayContaining(["snap-rail", "no-scrollbar"]));
  });

  const scrollers = UTILS.filter((u) => /overflow-x:\s*(auto|scroll)/.test(u.body));

  it("there is at least one such utility to check", () => {
    expect(scrollers.length).toBeGreaterThan(0);
  });

  it.each(scrollers.map((u) => [u.name, u] as const))(
    "@utility %s contains its overscroll",
    (name, u) => {
      expect(
        u.body,
        `@utility ${name} scrolls horizontally but lets the swipe chain into the app. ` +
          `Add overscroll-behavior-x: contain — on the SCROLLER, not on html/body, ` +
          `which only governs what the document hands outward.`,
      ).toMatch(/overscroll-behavior(-x)?:\s*(contain|none)/);
    },
  );

  it("the rails use contain rather than none, keeping their own end-of-travel", () => {
    const rail = UTILS.find((u) => u.name === "snap-rail");
    expect(rail?.body).toMatch(/overscroll-behavior-x:\s*contain/);
  });
});

describe("the document and the shell still refuse to pan", () => {
  it("html and body clip horizontally and chain nothing outward", () => {
    // The 2026-08-18 guard. Kept asserted so the new rule above is understood
    // as an addition to it rather than a replacement.
    expect(CSS).toMatch(/html,\s*body\s*\{[^}]*overscroll-behavior-x:\s*none/);
    expect(CSS).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*clip/);
  });

  it("the app shell clips too, since it is the frame that was seen moving", () => {
    expect(CSS).toMatch(/\[data-app-shell\]\s*\{[^}]*overflow-x:\s*clip/);
  });

  it("uses clip, never hidden, so sticky headers keep their containing block", () => {
    // hidden would make these scroll containers and silently change what
    // position: sticky sticks to — the reason recorded in styles.css.
    expect(CSS).not.toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/);
    expect(CSS).not.toMatch(/\[data-app-shell\]\s*\{[^}]*overflow-x:\s*hidden/);
  });
});

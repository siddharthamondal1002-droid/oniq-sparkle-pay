/**
 * DELETE IS ON THE SCREENS THE OWNER NAMED — image, voice and music.
 *
 * The first attempt at "give delete option in create across all four" put the
 * control on `/app/creations`. It worked, it was tested, and it was
 * UNREACHABLE: the only inbound reference to that route in the whole app is a
 * "back" link on a not-found page. So the feature shipped and the owner
 * correctly reported it as not done.
 *
 * All three Create screens already list what you made — each calls
 * `action: "list"` and renders a card per row — so this asserts the delete
 * control sits on those cards. It is the same shape as `upiDoors.test.ts`: a
 * feature is where its doors are, and a control nobody can reach is not a
 * control.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
/** The comments here quote every marker below. Prose goes first. */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const read = (p: string) => codeOnly(readFileSync(join(ROOT, p), "utf8"));

const SCREENS = [
  { route: "app.image", kind: "picture", testId: "image-picture-delete" },
  { route: "app.music", kind: "song", testId: "music-song-delete" },
  { route: "app.voice", kind: "clip", testId: "voice-clip-delete" },
] as const;

describe("every Create screen that lists your work can delete it", () => {
  for (const s of SCREENS) {
    it(`${s.route} renders the delete control`, () => {
      const src = read(`src/routes/_authenticated/${s.route}.tsx`);
      // It lists — otherwise there is nothing to delete and this whole
      // assertion is about the wrong screen.
      expect(src, `${s.route} stopped listing past creations`).toMatch(/action:\s*["']list["']/);
      expect(src, `${s.route} lost its delete control`).toContain("OniqDeleteCreation");
      expect(src).toContain(`testId="${s.testId}"`);
      expect(src, `${s.route} deletes the wrong kind`).toContain(`kind="${s.kind}"`);
    });
  }

  it("the control removes the row only through the shared helper", () => {
    // deleteCreation owns what deleting MEANS — the server marks the row
    // rather than removing it, because those tables are the daily-cap
    // ledgers. A screen calling the function directly would be free to skip
    // that, so the component is the only caller.
    const comp = read("src/components/oniq/OniqDeleteCreation.tsx");
    expect(comp).toContain("deleteCreation(kind, id)");
    expect(comp, "the row now leaves the list before the server agrees").toContain(
      "if (res.ok) onDeleted();",
    );
  });
});

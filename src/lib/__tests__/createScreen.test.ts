/**
 * CREATE IS A SCREEN NOW, and the parts of that which are easy to undo.
 *
 * OWNER DIRECTIVE 2026-09-04f. The reference draws Create with its own
 * header, the bottom nav still visible, a hero, the six cards and "My
 * Creations". ONIQ had it as a sheet: the cards inside already matched, but a
 * sheet has no URL, cannot be linked to or returned to with a back gesture,
 * and cannot hold a section like My Creations without becoming a scroll
 * inside a scroll. Asked which to build, the owner chose the screen.
 *
 * Three properties are worth holding, because each is one careless edit away
 * from being lost:
 *
 *   1. THE GRID MARKUP LIVES ONCE. Two copies of a six-card grid is how a
 *      radius, a tint or a "Not yet" badge ends up different on two surfaces
 *      that are meant to be the same thing.
 *   2. THE HERO HAS NOTHING TAPPABLE. The reference draws four chips whose
 *      behaviour is not legible from a picture. Four dead controls on the
 *      most prominent surface in the app is the failure this repo keeps
 *      avoiding; they go in when the owner says what they do.
 *   3. MY CREATIONS COSTS NOTHING. It reads three `list` actions, which sign
 *      URLs and pass none of the spend gates. A screen you land on from a nav
 *      button must not be able to spend money by being opened.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SCREEN = read("src/routes/_authenticated/app.create.tsx");
const SHELL = read("src/routes/_authenticated/app.tsx");
const GRID = read("src/components/oniq/OniqCreateGrid.tsx");

describe("the screen exists and the sheet does not", () => {
  it("is a real route with a URL", () => {
    expect(existsSync(join(ROOT, "src/routes/_authenticated/app.create.tsx"))).toBe(true);
    expect(SCREEN).toContain('createFileRoute("/_authenticated/app/create")');
    // Registered in the generated tree, which is what makes the link type-check.
    expect(read("src/routeTree.gen.ts")).toContain("/_authenticated/app/create");
  });

  it("replaced the sheet rather than sitting beside it", () => {
    // Two Creates is worse than either one: the nav opens one, a link opens
    // the other, and they drift.
    expect(existsSync(join(ROOT, "src/components/oniq/OniqCreateLauncher.tsx"))).toBe(false);
    expect(SHELL).not.toContain("OniqCreateLauncher");
    expect(SHELL).not.toContain("createOpen");
  });

  it("is where the nav's centre button goes", () => {
    expect(SHELL).toMatch(/onCreate=\{\(\) => void navigate\(\{ to: "\/app\/create" \}\)\}/);
  });

  it("still answers the window event Home's card fires", () => {
    // That card cannot reach the router from where it sits, so the event is
    // its only way in. Removing the listener would silently kill it.
    expect(SHELL).toContain('window.addEventListener("oniq:open-create"');
    const at = SHELL.indexOf('"oniq:open-create"');
    expect(SHELL.slice(at - 200, at)).toContain('to: "/app/create"');
  });

  it("keeps its back button off, because the nav is the way out", () => {
    expect(SHELL).not.toContain("OniqCreateLauncher");
    expect(SCREEN).toContain("back={null}");
  });
});

describe("the six cards are drawn in exactly one place", () => {
  it("lives in OniqCreateGrid and nowhere else", () => {
    expect(GRID).toContain("CREATE_GRID.map");
    expect(SCREEN).toContain("<OniqCreateGrid");
    expect(SCREEN).not.toContain("CREATE_GRID");
  });

  it("kept the badge and the not-yet treatment intact through the move", () => {
    expect(GRID).toContain("OniqIconBadge");
    expect(GRID).toContain("Not yet");
    // A dead card drops to the neutral hue rather than fading its own colour.
    expect(GRID).toContain('tint={live ? (c.tint ?? "slate") : "slate"}');
  });
});

describe("the hero", () => {
  it("asks the reference's question", () => {
    expect(SCREEN).toContain("What will you create today?");
    expect(SCREEN).toContain("OniqAIOrb");
  });

  it("carries nothing tappable, until somebody says what the chips do", () => {
    const from = SCREEN.indexOf("THE HERO.");
    const to = SCREEN.indexOf("<OniqCreateGrid");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const hero = SCREEN.slice(from, to);
    expect(hero).not.toMatch(/<button|onClick=|OniqChip|<Link/);
  });
});

describe("My Creations", () => {
  it("reads only the free list actions", () => {
    // Three `list` calls and nothing else. A screen reached by tapping a nav
    // button must not be able to spend money by being opened.
    expect(SCREEN.match(/action: "list"/g) ?? []).toHaveLength(1);
    expect(SCREEN.match(/functions\.invoke\(/g) ?? []).toHaveLength(1);
    expect(SCREEN).toContain("image-generate");
    expect(SCREEN).toContain("music-generate");
    expect(SCREEN).toContain("voice-generate");
    // The only body this screen ever sends. A `prompt` in a request body here
    // would be a generation, and a generation is a charge.
    expect(SCREEN.match(/body: \{[^}]*\}/g) ?? []).toEqual(['body: { action: "list" }']);
  });

  it("lets one failed list hide neither of the other two", () => {
    // A person with songs and no pictures still has songs.
    expect(SCREEN).toContain("Promise.all");
    expect(SCREEN).toMatch(/error \|\| !Array\.isArray\(rows\) \? \[\]/);
  });

  it("goes somewhere real", () => {
    expect(SCREEN).toContain('to="/app/creations"');
    expect(existsSync(join(ROOT, "src/routes/_authenticated/app.creations.tsx"))).toBe(true);
  });

  it("says so plainly when there is nothing yet", () => {
    // An empty grid of four blank squares reads as broken.
    expect(SCREEN).toContain("Nothing yet.");
  });
});

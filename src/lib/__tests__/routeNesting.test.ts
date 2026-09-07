/**
 * A NESTED ROUTE WHOSE PARENT HAS NO `<Outlet />` NEVER RENDERS.
 *
 * Reported 2026-09-07 as "firebase tab opens to nothing". The link was
 * there (adminDoors.test.ts had just been written to guarantee it), the
 * route file was correct, the chunk was served, the edge function was
 * deployed, and the screen had still never appeared for anyone.
 *
 * TanStack's flat file convention nests by DOTS. `app.admin.firebase.tsx`
 * became a CHILD of `app.admin.tsx`, and a child renders only where its
 * parent puts an `<Outlet />`. `app.admin.tsx` is the Moderation inbox — a
 * leaf screen, no Outlet — so navigating to /app/admin/firebase mounted the
 * INBOX and silently dropped the tool. All three admin tools were dead the
 * same way, since the day each was written.
 *
 * Nothing went red. Every check that could be run passed:
 *
 *     tsc                      clean   — the route typechecks either way
 *     the link exists          yes     — adminDoors.test.ts asserted it
 *     the marker is in the     yes     — the chunk is fetched and parsed;
 *       served chunk                     the component is simply never called
 *     the edge function 401s   yes     — the server was always fine
 *
 * THE CHUNK CHECK IS THE ONE TO DISTRUST HERE, because it is the one
 * `oniq-ship` prescribes and it looks like proof. A route chunk ships
 * whether or not anything mounts it: "the asset is reachable" and "the page
 * renders it" are the first and third of that skill's three claims, and this
 * confused them for two days.
 *
 * So the guard is structural, and it is app-wide rather than another admin
 * special case. For every route file whose dot-parent EXISTS as a file, that
 * parent must render an `<Outlet />`. The fix when it fails is either to add
 * one, or — as here — to opt the child out of nesting with a trailing
 * underscore on the parent segment (`app.admin_.firebase.tsx`), which changes
 * the route id and leaves the URL alone.
 *
 * Comments are stripped first. `app.admin.tsx` may one day explain in prose
 * why it deliberately has no Outlet, and a guard that reads the explanation
 * as the code would pass on the very file it exists to catch. That is the
 * sixth prose match in this repo in four days.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const ROUTES = join(process.cwd(), "src/routes");

type Pair = { child: string; parent: string; parentFile: string };

/**
 * Every (child, parent) pair the flat convention actually creates.
 *
 * A file nests under its dot-prefix ONLY when a file by that name exists —
 * `app.chat.calls.tsx` nests under `app.chat.tsx`, while `app.jobs-apps.tsx`
 * nests under `app.tsx` and `app.admin_.firebase.tsx` looks for
 * `app.admin_.tsx`, finds nothing, and is therefore top-level. That is the
 * generator's own rule, restated; deriving it from the file names rather than
 * from routeTree.gen.ts is deliberate, since the generated tree is an output
 * of the same rule and would only agree with itself.
 */
function nestedPairs(dir: string, out: Pair[] = []): Pair[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") nestedPairs(full, out);
      continue;
    }
    if (!entry.name.endsWith(".tsx")) continue;
    if (entry.name.startsWith("-")) continue; // the generator's own ignore prefix
    const segments = entry.name.replace(/\.tsx$/, "").split(".");
    if (segments.length < 2) continue;
    const parentFile = join(dir, segments.slice(0, -1).join(".") + ".tsx");
    if (!existsSync(parentFile)) continue;
    out.push({ child: entry.name, parent: segments.slice(0, -1).join("."), parentFile });
  }
  return out;
}

const PAIRS = nestedPairs(ROUTES);

describe("a nested route's parent renders an Outlet", () => {
  it("finds the nesting at all, so this cannot pass vacuously", () => {
    // If the convention or the directory moves, PAIRS empties and every
    // assertion below trivially passes — which is exactly how a guard stops
    // guarding without going red. There were 42 real pairs when this was
    // written; 20 is a floor, not a target.
    expect(PAIRS.length, "no nested route files found — has the layout moved?").toBeGreaterThan(20);
  });

  for (const { child, parent, parentFile } of PAIRS) {
    it(`${child} renders, because ${parent}.tsx has an Outlet`, () => {
      const code = stripComments(readFileSync(parentFile, "utf8"));
      expect(
        code,
        `${child} nests under ${parent}.tsx, which renders no <Outlet /> — the child ` +
          `component will never mount. Either add one, or opt out of nesting by ` +
          `renaming the child to ${parent}_.${child.slice(parent.length + 1)}`,
      ).toMatch(/<Outlet\b/);
    });
  }
});

describe("the three admin tools are opted out of nesting", () => {
  // The specific regression. app.admin.tsx is a leaf screen and giving it an
  // Outlet would draw the whole Moderation inbox above each tool, so the
  // underscore is the right half of the fix rather than the lazy one.
  for (const tool of ["firebase", "video", "gpu-video"]) {
    it(`app.admin_.${tool}.tsx, not app.admin.${tool}.tsx`, () => {
      const dir = join(ROUTES, "_authenticated");
      expect(existsSync(join(dir, `app.admin_.${tool}.tsx`))).toBe(true);
      expect(existsSync(join(dir, `app.admin.${tool}.tsx`))).toBe(false);
    });
  }
});

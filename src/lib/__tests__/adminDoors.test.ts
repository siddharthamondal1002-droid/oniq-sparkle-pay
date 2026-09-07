/**
 * EVERY ADMIN ROUTE HAS A DOOR.
 *
 * Reported 2026-09-07 as "admin features not showing in id". The flag was
 * fine — `profiles.is_admin` was true and the owner is the only admin — and
 * every tool worked. Three of the four simply had NO LINK ANYWHERE:
 *
 *     /app/admin              linked from app.profile.tsx
 *     /app/admin/video        NO LINK ANYWHERE
 *     /app/admin/gpu-video    NO LINK ANYWHERE
 *     /app/admin/firebase     NO LINK ANYWHERE
 *
 * They could only be reached by typing the URL, and the Profile screen — the
 * one place an admin looks, and the one place that already had the inbox link
 * — advertised none of them.
 *
 * THIS IS THE THIRD TIME IN TWO DAYS. `upiDoors.test.ts` records a feature
 * shipped "active and unreachable"; `/app/creations` shipped a delete control
 * on a screen with one inbound link, from a not-found page. Each time the code
 * was correct and the door was missing, and each time it was found by a person
 * using the app rather than by anything in CI.
 *
 * So this is the generalised guard rather than a fourth special case: it
 * ENUMERATES the admin route files and fails if any of them is not linked
 * from some other source file. It cannot know whether a link is reachable in
 * practice — only that one exists — but "no link at all" is the failure that
 * has actually happened, three times.
 *
 * NOTE the exclusions are deliberate and narrow: `routeTree.gen.ts` names
 * every route by construction, so counting it would make this vacuous, and a
 * route file linking to itself is not a door.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ROUTES = join(ROOT, "src/routes/_authenticated");

/** `app.admin.gpu-video.tsx` -> `/app/admin/gpu-video` */
function routePath(file: string): string {
  return (
    "/" +
    file
      .replace(/\.tsx$/, "")
      .split(".")
      .join("/")
  );
}

/** Every source file that could hold a link, minus the generated tree. */
function linkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) linkSources(full, out);
    else if (/\.tsx?$/.test(name.name) && name.name !== "routeTree.gen.ts") out.push(full);
  }
  return out;
}

const ADMIN_ROUTES = readdirSync(ROUTES)
  .filter((f) => /^app\.admin.*\.tsx$/.test(f))
  .sort();

const SOURCES = linkSources(join(ROOT, "src")).filter((f) => !f.includes("__tests__"));

describe("every admin route is reachable without typing a URL", () => {
  it("finds the admin routes at all, so this cannot pass vacuously", () => {
    // If the naming convention changes, ADMIN_ROUTES empties and every
    // assertion below trivially passes — which is exactly how a guard stops
    // guarding without going red.
    expect(
      ADMIN_ROUTES.length,
      "no app.admin.* routes found — has the naming changed?",
    ).toBeGreaterThanOrEqual(4);
  });

  for (const file of ADMIN_ROUTES) {
    const path = routePath(file);
    it(`${path} is linked from somewhere`, () => {
      const self = join(ROUTES, file);
      const linkers = SOURCES.filter((f) => {
        if (f === self) return false; // a route linking to itself is not a door
        return readFileSync(f, "utf8").includes(`"${path}"`);
      }).map((f) => f.slice(ROOT.length + 1));
      expect(
        linkers.length,
        `${path} has NO LINK ANYWHERE — it can only be reached by typing the URL`,
      ).toBeGreaterThan(0);
    });
  }
});

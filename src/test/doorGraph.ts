/**
 * WHICH SCREENS A PERSON CAN ACTUALLY REACH.
 *
 * ONIQ has shipped four features nobody could get to — the UPI entry that was
 * "active" with no tile (reported as "no tabs, no icons"), the delete controls
 * on `/app/creations`, the health report picker one tab across, and the three
 * admin tools that never rendered. CLAUDE.md's rule after the third was "grep
 * for what LINKS to the screen it lives on", and it was run for the fourth and
 * came back EMPTY — the health tab is assembled from a template literal that no
 * literal search can see. So this reads the app's own link expressions instead.
 *
 * A DOOR IS A FORWARD AFFORDANCE, AND THAT DISTINCTION IS THE WHOLE GUARD.
 * `/app/creations` was never unreferenced: its only inbound links were two
 * `back="/app/creations"` props on a NOT-FOUND page, which is a way out of
 * being lost rather than a way in. Counting any mention would have called that
 * screen reachable, which is exactly the mistake that shipped. So `back=`,
 * route-level `redirect()` and a route's links to itself are all excluded.
 *
 * `back=` IS EXCLUDED BY NOT BEING LOOKED FOR, and the distinction matters
 * because the first draft said otherwise. It carried a `(?<!back=)` lookbehind
 * on the `to=` pattern, which reads like the discriminating step and is
 * VACUOUS — `back="/x"` contains no `to=` substring, so the lookbehind never
 * fired and removing it opened nothing. The mutation run said so by escaping.
 * The real rule is the prop NAME: only forward affordances are matched, and a
 * future edit that adds a `back=` pattern here is what the mutation now tests.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

/** Trailing slashes are a routeTree spelling, not a different screen. */
export function normalisePath(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/** Every authenticated screen the router can actually serve. */
export function appRoutes(): string[] {
  const tree = readFileSync(resolve(ROOT, "src/routeTree.gen.ts"), "utf8");
  const found = [...tree.matchAll(/fullPath:\s*'([^']+)'/g)].map((m) => normalisePath(m[1]));
  return [...new Set(found)].filter((p) => p === "/app" || p.startsWith("/app/")).sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") walk(p, out);
    } else if (/\.tsx?$/.test(p) && !p.endsWith("routeTree.gen.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Source files that ship — tests and the generated tree are not doors. */
export function sourceFiles(): string[] {
  return walk(resolve(ROOT, "src"));
}

/**
 * Path constants a link can be built from. Measured 2026-09-12: exactly one
 * exists (`HEALTH_ROUTE`), and it is the one that defeated the literal grep.
 * Read from source rather than listed here, so a second constant is resolved
 * the day it appears instead of silently producing a false orphan.
 */
export function routeConstants(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*"(\/[^"]*)"/g)) {
      map[m[1]] = m[2];
    }
  }
  return map;
}

export type Door = { readonly to: string; readonly from: string };

/**
 * FORWARD affordances only:
 *   to="/app/x"  to={"/app/x"}  to={`${CONST}/x`}     JSX navigation
 *   to: "/app/x"  to: `${CONST}/x`                    a nav or registry entry
 *   navigate({ to: "/app/x" })                        a programmatic push
 *
 * Deliberately NOT doors: `back=` (a return, see the header), `redirect({to})`
 * (how a retired route forwards traffic away from itself), and any link a file
 * makes to the very route it defines.
 */
export function doorsFound(): Door[] {
  const constants = routeConstants();
  const doors: Door[] = [];

  const resolveTemplate = (body: string): string | null => {
    const m = /^\$\{([A-Z][A-Z0-9_]*)\}(.*)$/.exec(body);
    if (!m) return body.startsWith("/") ? body : null;
    const base = constants[m[1]];
    return base ? base + m[2] : null;
  };

  for (const file of sourceFiles()) {
    const src = readFileSync(file, "utf8");
    const rel = file.replace(ROOT + "/", "");
    const ownRoute = /createFileRoute\("\/_authenticated(\/[^"]*)"\)/.exec(src)?.[1];

    const push = (raw: string | null) => {
      if (!raw) return;
      const to = normalisePath(raw);
      if (!to.startsWith("/app")) return;
      if (ownRoute && normalisePath(ownRoute) === to) return; // a self-link is not a door
      doors.push({ to, from: rel });
    };

    for (const m of src.matchAll(/\bto=\{?"(\/[^"]*)"/g)) push(m[1]);
    for (const m of src.matchAll(/\bto=\{`([^`]*)`\}/g)) push(resolveTemplate(m[1]));
    for (const m of src.matchAll(/\bto:\s*"(\/[^"]*)"/g)) push(m[1]);
    for (const m of src.matchAll(/\bto:\s*`([^`]*)`/g)) push(resolveTemplate(m[1]));
    for (const m of src.matchAll(/\bto=\{([A-Z][A-Z0-9_]*)\}/g)) push(constants[m[1]] ?? null);
  }
  return doors;
}

/** Routes with at least one forward door into them. */
export function routesWithDoors(): Set<string> {
  return new Set(doorsFound().map((d) => d.to));
}

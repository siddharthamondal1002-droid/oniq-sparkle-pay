/**
 * P23 — the read-only content proxies must not hang on a dead upstream.
 *
 * faith-scripture, devotional-radio and mappls-geo each fan out to third-party
 * APIs that owe ONIQ nothing. Every call site already CATCHES a thrown error
 * and degrades gracefully, but a socket that connects and then never answers
 * throws nothing — it holds the request open to the function's wall-clock
 * limit. Routing every external call through fetchWithTimeout (AbortController)
 * turns that silent stall into a fast, already-handled failure.
 *
 * Edge functions run on Deno and are outside tsconfig, so — as with the other
 * edge guards in this repo — the defending shape is pinned in source.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const EDGE_FNS = [
  "supabase/functions/faith-scripture/index.ts",
  "supabase/functions/devotional-radio/index.ts",
  "supabase/functions/mappls-geo/index.ts",
];

describe("fetchWithTimeout helper", () => {
  const src = read("supabase/functions/_shared/fetchTimeout.ts");
  it("aborts the request at a deadline and clears the timer", () => {
    expect(src).toMatch(/new AbortController\(\)/);
    expect(src).toMatch(/setTimeout\(\(\) => controller\.abort\(\)/);
    expect(src).toMatch(/signal:\s*controller\.signal/);
    expect(src).toMatch(/clearTimeout\(timer\)/);
  });
  it("does not swallow the abort into a fake Response — the caller still decides", () => {
    // It returns the fetch Response or throws; it never returns a synthesized
    // ok:false Response that would hide the timeout from the caller's handling.
    expect(src).not.toMatch(/new Response\(/);
  });
});

describe("the read-only proxies route every external call through the timeout", () => {
  for (const path of EDGE_FNS) {
    it(`${path.split("/")[2]} imports and uses fetchWithTimeout with no bare fetch()`, () => {
      const src = read(path);
      expect(src, "helper not imported").toMatch(
        /import \{ fetchWithTimeout \} from "\.\.\/_shared\/fetchTimeout\.ts"/,
      );
      expect(src, "helper unused").toMatch(/fetchWithTimeout\(/);
      // No bare fetch( remains (fetchWithTimeout is fine; the raw global is not).
      const bare = src.match(/(?<![A-Za-z])fetch\(/g) ?? [];
      expect(bare, `bare fetch() still present in ${path}`).toHaveLength(0);
    });
  }
});

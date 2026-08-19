/**
 * P17 guard: a handler that reads the current user must not dereference it with
 * a non-null assertion. `supabase.auth.getUser()` returns `{ user: null }` when
 * the session has silently expired; `u.user!.id` then throws inside the async
 * click handler, the busy flag is never cleared, and the control sticks with no
 * feedback. Each site below now guards `if (!u.user)` and drops the `!`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const GUARDED = [
  "src/routes/_authenticated/app.profile.tsx",
  "src/routes/_authenticated/app.upi.tsx",
  "src/routes/_authenticated/app.scan.tsx",
];

describe("expired-session guards — no bare user! deref in write handlers", () => {
  for (const path of GUARDED) {
    it(`${path} guards the user before using its id`, () => {
      const src = read(path);
      expect(src, "a bare u.user!.id assertion remains").not.toMatch(/u\.user!\.id/);
      expect(src, "the expired-session guard is missing").toContain("if (!u.user)");
    });
  }
});

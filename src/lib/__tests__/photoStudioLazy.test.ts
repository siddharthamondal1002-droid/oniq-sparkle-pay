/**
 * PERF — the photo editor must stay lazy.
 *
 * PhotoStudio (crop/filters/face-fx, ~5KB gz plus its face-fx code) is only
 * ever rendered after a user picks a photo to edit, but it used to be a static
 * import in every surface that CAN edit a photo (chat threads, the moments
 * feed, the avatar sheet), so it loaded in the initial JS of those screens.
 * It is now imported through a React.lazy boundary. These source assertions
 * keep it that way — a plain `from "@/components/photo/PhotoStudio"` in a
 * consumer would silently pull it back into the eager bundle.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const CONSUMERS = [
  "src/components/profile/AvatarEditorSheet.tsx",
  "src/components/moments/MomentsFeed.tsx",
  "src/routes/_authenticated/app.chat.$conversationId.tsx",
];

describe("PhotoStudio lazy boundary", () => {
  it("the wrapper loads PhotoStudio through React.lazy + Suspense", () => {
    const src = read("src/components/photo/PhotoStudioLazy.tsx");
    expect(src).toMatch(/lazy\(\(\) =>\s*import\("\.\/PhotoStudio"\)/);
    expect(src).toMatch(/Suspense/);
  });

  for (const path of CONSUMERS) {
    it(`${path.split("/").pop()} imports PhotoStudio through the lazy wrapper, not directly`, () => {
      const src = read(path);
      expect(src, "should import the lazy wrapper").toMatch(
        /from "@\/components\/photo\/PhotoStudioLazy"/,
      );
      // No direct static import of the heavy component remains.
      expect(src, "direct static PhotoStudio import reintroduced").not.toMatch(
        /from "@\/components\/photo\/PhotoStudio"/,
      );
    });
  }
});

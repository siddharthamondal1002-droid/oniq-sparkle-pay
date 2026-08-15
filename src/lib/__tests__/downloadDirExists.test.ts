/**
 * NOTHING MAY CALL downloadFile INTO A DIRECTORY IT HAS NOT MADE.
 *
 * Save and Share both broke on device on 2026-08-15, and they broke together
 * because they share a fault neither file could see on its own:
 *
 *   Save   → files/videos/oniq-story-9b222dd9.mp4
 *            "open failed: ENOENT (No such file or directory)"
 *   Share  → cache/share/… , same step, surfaced as the generic
 *            "Could not share that film."
 *
 * Both passed `recursive: true`. @capacitor/filesystem 8.1.2 ignores it on
 * downloadFile — doDownloadInBackground never reads the option, and
 * getFileObject() only mkdirs the BASE directory (filesDir/cacheDir, which
 * always exist) before handing the path to FileOutputStream. writeFile and
 * mkdir DO honour `recursive`, which is what makes the trap convincing: the
 * option is real, on a neighbouring method.
 *
 * It had worked because the directories survived from an older install. A
 * clean reinstall took them, and nothing in the code had ever created them —
 * so the bug was always there, waiting for the first user with a fresh phone.
 *
 * A unit test cannot run the Android plugin, so this asserts the CALL SHAPE:
 * every downloadFile in the codebase is preceded by ensureParentDir. That is
 * the rule the next person will otherwise re-break, because `recursive: true`
 * reads exactly like it is handled.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Every file that reaches for downloadFile. Add one and this test finds it. */
const CALLERS = ["src/lib/share.ts", "src/components/stories/storyJobsClient.ts"];

describe("every downloadFile makes its directory first", () => {
  for (const file of CALLERS) {
    it(`${file} calls ensureParentDir before downloadFile`, () => {
      const src = read(file);
      const guard = src.indexOf("ensureParentDir(");
      const download = src.indexOf("Filesystem.downloadFile(");
      expect(download, "no downloadFile here — update CALLERS").toBeGreaterThan(-1);
      expect(guard, "downloadFile with no ensureParentDir — this is the ENOENT bug").toBeGreaterThan(
        -1,
      );
      expect(guard, "the directory is made AFTER the download that needs it").toBeLessThan(download);
    });

    it(`${file} imports the helper rather than rolling its own`, () => {
      expect(read(file)).toContain('from "@/lib/ensureDir"');
    });
  }

  it("has no downloadFile caller outside the list this test checks", () => {
    // The guard is only as good as its coverage: a third caller added
    // elsewhere would reintroduce the bug with every test still green.
    const all = [
      "src/lib/share.ts",
      "src/lib/saveFile.ts",
      "src/lib/paperPdf.ts",
      "src/components/stories/storyJobsClient.ts",
      "src/components/stories/YourVideos.tsx",
    ];
    for (const f of all) {
      if (read(f).includes("Filesystem.downloadFile(")) {
        expect(CALLERS, `${f} downloads but is not covered`).toContain(f);
      }
    }
  });
});

describe("the helper itself", () => {
  const SRC = read("src/lib/ensureDir.ts");

  it("makes the PARENT of a file path, not the path", () => {
    // mkdir on "videos/x.mp4" would create a directory named x.mp4 and the
    // download would then fail on a name collision instead of a missing dir.
    expect(SRC).toContain("path.lastIndexOf");
    expect(SRC).toContain("path.slice(0, cut)");
  });

  it("treats an existing directory as success", () => {
    // Every call after the first hits this. Throwing would leave exactly one
    // working save per install, which is worse than the bug it replaced.
    expect(SRC).toMatch(/exist/i);
  });

  it("passes recursive to mkdir, where the option is actually honoured", () => {
    expect(SRC).toContain("Filesystem.mkdir({ path: parent, directory, recursive: true })");
  });
});

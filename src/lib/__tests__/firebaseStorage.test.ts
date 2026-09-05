/**
 * THE OBJECT PATH IS THE ONLY THING SEPARATING ONE PERSON'S FILES FROM ANOTHER'S.
 *
 * Owner directive 2026-09-05: "Storage = photos/videos/files", with Postgres
 * staying the system of record. That last part is what makes this file
 * load-bearing. Every other store ONIQ has is governed by RLS — 242 policies
 * that decide, per row, who may see what. A bucket reached with the SERVICE
 * ACCOUNT has no such boundary: the credential can read and write every object
 * in it, so nothing in Google's stack will stop `users/<someone-else>/…` being
 * fetched. The server deriving the path from the caller's OWN id, and never
 * from anything they sent, is the entire access-control story.
 *
 * These tests are the adversarial half: every way a filename could climb out
 * of the prefix it was given.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIREBASE_BUCKET,
  KINDS,
  MAX_SEGMENT,
  STORAGE_PERMISSIONS,
  isKind,
  objectPathFor,
  objectUrl,
  ownsPath,
  safeSegment,
  testPermissionsUrl,
  uploadUrl,
} from "../../../supabase/functions/_shared/firebaseStorage.ts";

const UID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "11111111-2222-3333-4444-555555555555";

describe("a filename cannot climb out of its owner's prefix", () => {
  it.each([
    ["../../etc/passwd", "traversal"],
    ["..", "bare dots"],
    ["....//....//x", "doubled traversal"],
    ["/absolute.jpg", "leading slash"],
    ["a/b/c.jpg", "embedded slashes"],
    ["..\\..\\win.jpg", "backslash traversal"],
    ["%2e%2e%2fx", "percent-encoded traversal"],
    ["null.jpg", "NUL byte"],
    [".hidden", "leading dot"],
  ])("%s (%s) stays one harmless segment", (name) => {
    const seg = safeSegment(name);
    expect(seg).not.toContain("/");
    expect(seg).not.toContain("\\");
    expect(seg).not.toContain("..");
    expect(seg.startsWith(".")).toBe(false);
    // And the assembled path is still exactly four segments under the owner.
    const path = objectPathFor(UID, "images", name);
    expect(path.split("/")).toHaveLength(4);
    expect(path.startsWith(`users/${UID}/images/`)).toBe(true);
  });

  it("no crafted filename can reach another user's prefix", () => {
    for (const attack of [
      `../${OTHER}/images/x.jpg`,
      `../../users/${OTHER}/images/x.jpg`,
      `..%2f..%2fusers%2f${OTHER}%2fx.jpg`,
    ]) {
      const path = objectPathFor(UID, "images", attack);
      expect(ownsPath(UID, path)).toBe(true);
      expect(ownsPath(OTHER, path), attack).toBe(false);
      expect(path).not.toContain(`/${OTHER}/`);
    }
  });

  it("keeps an ordinary filename readable rather than mangling it", () => {
    // A guard nobody can live with gets removed. Normal names must survive.
    expect(safeSegment("holiday-2026_01.JPG")).toBe("holiday-2026_01.JPG");
    expect(safeSegment("my song.mp3")).toBe("my_song.mp3");
  });

  it("never returns an empty segment, which would collapse the path", () => {
    for (const empty of ["", "   ", "///", "...", null, undefined, 42, {}]) {
      const seg = safeSegment(empty);
      expect(seg.length, JSON.stringify(empty)).toBeGreaterThan(0);
    }
    expect(objectPathFor(UID, "images", "").split("/")).toHaveLength(4);
  });

  it("bounds the segment, so a key cannot be unbounded", () => {
    expect(safeSegment("x".repeat(5000))).toHaveLength(MAX_SEGMENT);
  });
});

describe("the owner and the kind are not the caller's to choose", () => {
  it("refuses to build a path without a real owner", () => {
    // The catastrophic case: an empty uid would put every user's files in one
    // shared folder, which looks like it works right up until it doesn't.
    for (const bad of ["", "   ", "/", "..", null, undefined]) {
      expect(() => objectPathFor(bad as string, "images", "a.jpg"), String(bad)).toThrow();
    }
  });

  it("refuses a kind outside the closed list", () => {
    expect(KINDS).toEqual(["images", "video", "audio", "docs"]);
    for (const bad of ["private", "../", "", null, undefined]) {
      expect(isKind(bad), String(bad)).toBe(false);
      expect(() => objectPathFor(UID, bad as never, "a.jpg"), String(bad)).toThrow();
    }
  });

  it("ownsPath is not fooled by a prefix that merely starts the same", () => {
    // `users/<uid>extra/...` starts with `users/<uid>` as a STRING but is a
    // different folder. The trailing slash is what makes the check a folder
    // check rather than a substring one.
    expect(ownsPath(UID, `users/${UID}/images/a.jpg`)).toBe(true);
    expect(ownsPath(UID, `users/${UID}-evil/images/a.jpg`)).toBe(false);
    expect(ownsPath(UID, `users/${UID}`)).toBe(false);
    expect(ownsPath("", `users//images/a.jpg`)).toBe(false);
  });
});

describe("the URLs point at the project's own bucket", () => {
  it("uses the bucket google-services.json names", () => {
    // Measured 2026-09-05 from android/app/google-services.json. A different
    // bucket here would silently write somewhere nobody is looking.
    expect(FIREBASE_BUCKET).toBe("oniq-309bd.firebasestorage.app");
  });

  it("percent-encodes the object name, slashes included", () => {
    // GCS treats an un-encoded "/" in the object id as a path separator in
    // the URL and 404s, which reads as "missing file" rather than "bad URL".
    const path = objectPathFor(UID, "images", "a.jpg");
    expect(objectUrl(FIREBASE_BUCKET, path)).toContain(encodeURIComponent(path));
    expect(objectUrl(FIREBASE_BUCKET, path)).not.toContain(`/o/${path}`);
    expect(uploadUrl(FIREBASE_BUCKET, path)).toContain(`name=${encodeURIComponent(path)}`);
  });

  it("asks for exactly the three permissions an upload path needs", () => {
    expect(STORAGE_PERMISSIONS).toEqual([
      "storage.objects.create",
      "storage.objects.get",
      "storage.objects.delete",
    ]);
    const url = testPermissionsUrl(FIREBASE_BUCKET);
    for (const p of STORAGE_PERMISSIONS) expect(url).toContain(encodeURIComponent(p));
  });
});

describe("the inspector asks the write question without writing", () => {
  const SRC = readFileSync(
    join(process.cwd(), "supabase/functions/firebase-provisioning/index.ts"),
    "utf8",
  );
  const codeOnly = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("uses testIamPermissions rather than a trial upload", () => {
    // A trial write would answer the same question and leave an object behind
    // in a bucket the function is documented as never modifying.
    expect(codeOnly).toContain("testPermissionsUrl");
    expect(codeOnly, "the inspector gained a write").not.toMatch(/method:\s*["'](POST|PUT)["']/);
    expect(codeOnly, "the inspector gained an upload").not.toContain("uploadUrl");
  });

  it("reports the permissions HELD, not just a boolean", () => {
    // A partial grant — create but not delete, say — is a different problem
    // from no grant, and collapsing both to false hides which one it is.
    expect(codeOnly).toContain("storagePermissions");
    expect(codeOnly).toContain("held:");
  });
});

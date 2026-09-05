/**
 * THE OBJECT PREFIX IS THE ONLY THING SEPARATING ONE PERSON'S FILES FROM
 * ANOTHER'S, so it gets the adversarial half of the tests.
 *
 * `firebaseServer.test.ts` beside this file covers the happy shapes. This one
 * covers the two properties that are load-bearing rather than convenient:
 *
 *  1. NOTHING a caller sends can leave `users/{uid}/`. Postgres RLS governs
 *     every other store ONIQ has and governs NOTHING here — a bucket reached
 *     with the service account has no per-user boundary of its own, so the
 *     server deriving the prefix from the verified session is the entire
 *     access-control story.
 *  2. A guard people can actually upload through. A rule that rejects the
 *     ordinary case gets loosened by whoever hits it next, and they will not
 *     stop at the part that was only inconvenient.
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  STORAGE_PERMISSIONS,
  safeFileSegment,
  safeObjectName,
  listObjects,
  safeSegment,
  testPermissionsUrl,
  userCollectionPath,
  userDocPath,
  userObjectPath,
  v4CanonicalRequest,
  type StoredObject,
} from "../../../supabase/functions/_shared/firebaseServer.ts";

const UID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "11111111-2222-3333-4444-555555555555";
const ch = String.fromCharCode;

describe("nothing a caller sends can leave its own prefix", () => {
  const ATTACKS: unknown[] = [
    "..",
    ".",
    "...",
    "../..",
    "../../etc/passwd",
    "/absolute",
    "a/b",
    "..\\..\\win",
    "%2e%2e%2f",
    "a..b",
    ch(0) + "x",
    ch(9),
    ch(0x202e) + "gpj.exe",
    "caf" + ch(0xe9),
    "．．",
    "x".repeat(129),
    "",
    "   ",
    null,
    undefined,
    42,
    {},
  ];

  it.each(ATTACKS.map((a, i) => [i, a] as const))(
    "segment case %i is refused or confined",
    (_i, raw) => {
      for (const seg of [safeSegment(raw), safeFileSegment(raw)]) {
        if (seg === null) continue; // refusing is the correct outcome
        expect(seg).not.toContain("/");
        expect(seg).not.toContain("..");
        expect(seg.length).toBeLessThanOrEqual(128);
      }
    },
  );

  it("no crafted object name reaches another user's subtree", () => {
    for (const attack of [
      `../${OTHER}/x.jpg`,
      `../../users/${OTHER}/x.jpg`,
      `..%2f..%2fusers%2f${OTHER}`,
      `photos/../../${OTHER}/x.jpg`,
    ]) {
      const name = safeObjectName(attack);
      if (name === null) continue;
      const path = userObjectPath(UID, name);
      expect(path.startsWith(`users/${UID}/`), attack).toBe(true);
      expect(path, attack).not.toContain(OTHER);
    }
  });

  it("bounds how deep and how long an object path can be", () => {
    expect(safeObjectName(Array(7).fill("seg").join("/"))).toBeNull();
    const deepest = safeObjectName(Array(6).fill("a".repeat(128)).join("/"));
    expect(deepest).not.toBeNull();
    expect(deepest!.length).toBeLessThanOrEqual(6 * 128 + 5);
  });
});

describe("the owner id is checked, not merely interpolated", () => {
  // Defence in depth. Today every uid is `claims.sub` off a verified JWT and
  // cannot hold a slash — but these builders are exported, and the prefix they
  // write is the whole boundary. A uid arriving from anywhere else must not be
  // able to walk out of it.
  it.each([["../" + OTHER], [".."], ["a/b"], [""], ["   "], ["x".repeat(129)]])(
    "refuses to build a path for owner %j",
    (bad) => {
      expect(() => userDocPath(bad, "notes", "n1")).toThrow();
      expect(() => userCollectionPath(bad, "notes")).toThrow();
      expect(() => userObjectPath(bad, "a.jpg")).toThrow();
    },
  );

  it("still accepts both id shapes ONIQ actually has", () => {
    // A Supabase UUID (36) today; a native Firebase uid (28) if identity ever
    // moves. Both must keep working, or the guard breaks the app to prove a
    // point.
    expect(userDocPath(UID, "notes", "n1")).toBe(`users/${UID}/notes/n1`);
    expect(userObjectPath("aBcDeFgHiJkLmNoPqRsTuVwXyZ01", "a.jpg")).toBe(
      "users/aBcDeFgHiJkLmNoPqRsTuVwXyZ01/a.jpg",
    );
  });
});

describe("a real filename survives the guard", () => {
  // The case that motivated widening the charset. These are what phones
  // actually produce; all four were refused outright before.
  it.each([
    "Screenshot 2026-09-05 at 10.13.45.png",
    "WhatsApp Image 2026-09-05 (1).jpeg",
    "beach day.jpg",
    "IMG_0001.JPG",
  ])("accepts %j unchanged", (name) => {
    expect(safeFileSegment(name)).toBe(name);
    expect(userObjectPath(UID, safeObjectName(name)!)).toBe(`users/${UID}/${name}`);
  });

  it("keeps the traversal rule strict while the charset is wider", () => {
    // The widening must not have bought convenience with safety.
    for (const bad of ["a/b", "..", "a..b", ".", "/x"]) {
      expect(safeFileSegment(bad), bad).toBeNull();
    }
  });

  it("still refuses non-ASCII, which is a known gap rather than a surprise", () => {
    // Recorded so it fails loudly if someone widens further without deciding:
    // the answer for arbitrary names is a generated id plus a display name in
    // Firestore, not a bigger regex.
    expect(safeFileSegment("R" + ch(0xe9) + "sum" + ch(0xe9) + ".pdf")).toBeNull();
  });

  it("Firestore ids stay on the narrow charset", () => {
    // A collection or document id is machine-chosen, so it has no reason to
    // carry a space and every reason to stay boring.
    expect(safeSegment("my notes")).toBeNull();
    expect(safeSegment("notes")).toBe("notes");
  });
});

describe("the inspector asks the write question without writing", () => {
  const SRC = readFileSync(
    join(process.cwd(), "supabase/functions/firebase-provisioning/index.ts"),
    "utf8",
  );
  const codeOnly = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("uses testIamPermissions rather than a trial upload", () => {
    // The bridge selftest answers "can it write?" by writing and cleaning up.
    // This one must stay read-only, so that when the selftest fails it can
    // separate a missing grant from a wrong bucket without leaving anything
    // behind.
    expect(codeOnly).toContain("testPermissionsUrl");
    expect(codeOnly, "the inspector gained a write").not.toMatch(/method:\s*["'](POST|PUT)["']/);
    expect(codeOnly, "the inspector gained an upload").not.toContain("uploadObject");
  });

  it("reports the permissions HELD, not just a boolean", () => {
    // A partial grant — create but not delete — is a different problem from no
    // grant, and collapsing both to false hides which one it is.
    expect(codeOnly).toContain("storagePermissions");
    expect(codeOnly).toContain("held:");
  });

  it("asks for exactly the three an upload path needs", () => {
    expect(STORAGE_PERMISSIONS).toEqual([
      "storage.objects.create",
      "storage.objects.get",
      "storage.objects.delete",
    ]);
    const url = testPermissionsUrl("oniq-309bd.firebasestorage.app");
    for (const p of STORAGE_PERMISSIONS) expect(url).toContain(encodeURIComponent(p));
  });
});

describe("the signed URL's canonical query is byte-sorted", () => {
  // A V4 signature is all-or-nothing and its failure ("403
  // SignatureDoesNotMatch") names nothing, so the ordering rule is asserted
  // here where a break is legible.
  const SIGNING_KEYS = {
    "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
    "X-Goog-Credential": "sa@p.iam.gserviceaccount.com/20260905/auto/storage/goog4_request",
    "X-Goog-Date": "20260905T071500Z",
    "X-Goog-Expires": "900",
    "X-Goog-SignedHeaders": "host",
  };

  it("the five signing keys are already in sorted order", () => {
    const keys = [...new URLSearchParams(SIGNING_KEYS).keys()];
    expect(keys).toEqual([...keys].sort());
  });

  it("sorting is by BYTE, so a capitalised extra is the case that reorders", () => {
    // The conventional extras are all lowercase and sort AFTER "X-Goog-*",
    // which is why nothing has broken. A capitalised key does not, and that
    // is the one a reader would not have in mind.
    const lower = [...new URLSearchParams({ ...SIGNING_KEYS, generation: "1" }).keys()];
    expect(lower, "a lowercase extra stays in order on its own").toEqual([...lower].sort());

    const upper = new URLSearchParams({ ...SIGNING_KEYS, "Content-Type": "text/plain" });
    const before = [...upper.keys()];
    upper.sort();
    expect(before, "a capitalised extra does reorder").not.toEqual([...upper.keys()]);
    expect([...upper.keys()]).toEqual([...before].sort());
  });

  it("signs over exactly the query string it puts in the URL", () => {
    // The canonical request and the URL must carry the same bytes; building
    // them from one sorted value is what guarantees it.
    const query = "X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Date=20260905T071500Z";
    const canonical = v4CanonicalRequest({ bucket: "b", object: "users/u/a.jpg", query });
    expect(canonical.split("\n")[2]).toBe(query);
    expect(canonical.split("\n")[1]).toBe("/b/users/u/a.jpg");
  });
});

describe("listing is confined to the owner's prefix", () => {
  it("an empty sub-prefix lists exactly the owner's own folder", () => {
    // `users/{uid}/` and not `users/{uid}` — the trailing slash is what makes
    // this a folder listing rather than a prefix match that would also catch
    // `users/{uid}-evil/`.
    expect(userObjectPath(UID, "")).toBe(`users/${UID}/`);
    expect(userObjectPath(UID, "")).not.toBe(`users/${UID}`);
  });

  it("a crafted sub-prefix is refused before it becomes a listing", () => {
    for (const bad of [`../${OTHER}`, "..", "a/../..", "/etc"]) {
      const sub = safeObjectName(bad);
      if (sub === null) continue;
      expect(userObjectPath(UID, sub).startsWith(`users/${UID}/`), bad).toBe(true);
    }
    expect(safeObjectName(`../${OTHER}`)).toBeNull();
  });

  // The repo guard in testIsolation.test.ts requires an afterEach restore, not
  // a local try/finally: a test that throws before its finally would leave the
  // stub installed for every file after it, and "no test can spend money" is
  // exactly the property that must not depend on the happy path.
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("strips the owner prefix off returned names and clamps the page size", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              name: `users/${UID}/study/algebra.pdf`,
              size: "1024",
              contentType: "application/pdf",
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;
    const r = await listObjects("tok", "b", `users/${UID}/`, 9999);
    expect(r.ok).toBe(true);
    const items = (r as { ok: true; data: StoredObject[] }).data;
    // A screen shows "study/algebra.pdf", never the owner's uid — and the full
    // path is still there for a follow-up call.
    expect(items[0].name).toBe("study/algebra.pdf");
    expect(items[0].object).toBe(`users/${UID}/study/algebra.pdf`);
    expect(items[0].size).toBe(1024);
    // Unbounded paging is how one caller walks the whole bucket.
    expect(calls[0]).toContain("maxResults=500");
    expect(calls[0]).toContain(encodeURIComponent(`users/${UID}/`));
  });
});

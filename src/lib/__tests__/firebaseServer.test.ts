// The pure half of the Firebase bridge: path safety and value mapping.
//
// These two are where a mistake is silent. A bad path segment is how one
// user's request reaches another user's subtree, and a wrong value tag is how
// a saved count comes back as a string.
import { describe, expect, it } from "vitest";
import {
  encodeObjectPath,
  fromFirestoreFields,
  safeObjectName,
  safeSegment,
  toFirestoreFields,
  toFirestoreValue,
  userDocPath,
  userObjectPath,
  v4CanonicalRequest,
  v4Timestamp,
} from "../../../supabase/functions/_shared/firebaseServer.ts";

describe("path safety", () => {
  it("accepts ordinary names", () => {
    expect(safeSegment("notes")).toBe("notes");
    expect(safeSegment("my-file_2.txt")).toBe("my-file_2.txt");
  });

  it("refuses anything that could walk out of the user's subtree", () => {
    for (const bad of ["..", ".", "a/b", "../other", "a..b", "", "  ", "x".repeat(129)]) {
      expect(safeSegment(bad)).toBeNull();
    }
    expect(safeSegment(undefined)).toBeNull();
    expect(safeSegment(42)).toBeNull();
  });

  it("allows nested object names but validates every piece", () => {
    expect(safeObjectName("photos/summer/1.jpg")).toBe("photos/summer/1.jpg");
    expect(safeObjectName("photos/../../etc")).toBeNull();
    expect(safeObjectName("a/b/c/d/e/f/g")).toBeNull();
  });

  it("always namespaces by the caller", () => {
    expect(userDocPath("uid-1", "notes", "n1")).toBe("users/uid-1/notes/n1");
    expect(userObjectPath("uid-1", "photos/1.jpg")).toBe("users/uid-1/photos/1.jpg");
  });
});

describe("firestore values", () => {
  it("tags integers and doubles differently", () => {
    expect(toFirestoreValue(3)).toEqual({ integerValue: "3" });
    expect(toFirestoreValue(3.5)).toEqual({ doubleValue: 3.5 });
  });

  it("round-trips a nested document", () => {
    const doc = {
      title: "hello",
      count: 7,
      ratio: 0.25,
      done: false,
      missing: null,
      tags: ["a", "b"],
      meta: { nested: { deep: 1 } },
    };
    expect(fromFirestoreFields(toFirestoreFields(doc))).toEqual(doc);
  });

  it("reads an unknown tag as null instead of throwing", () => {
    expect(fromFirestoreFields({ x: { geoPointValue: { latitude: 1 } } })).toEqual({ x: null });
  });
});

describe("signed url pieces", () => {
  it("formats the V4 timestamp", () => {
    expect(v4Timestamp(new Date("2026-09-05T07:15:00.000Z"))).toEqual({
      stamp: "20260905T071500Z",
      date: "20260905",
    });
  });

  it("keeps slashes readable but escapes the rest", () => {
    expect(encodeObjectPath("users/u 1/a+b.txt")).toBe("users/u%201/a%2Bb.txt");
  });

  it("builds the canonical request Google signs", () => {
    expect(v4CanonicalRequest({ bucket: "b", object: "users/u/a.txt", query: "X=1" })).toBe(
      [
        "GET",
        "/b/users/u/a.txt",
        "X=1",
        "host:storage.googleapis.com",
        "",
        "host",
        "UNSIGNED-PAYLOAD",
      ].join("\n"),
    );
  });
});

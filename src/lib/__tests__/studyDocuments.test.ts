/**
 * A kept document has to be one the server will actually accept, and one the
 * student can still recognise in a list.
 */
import { describe, expect, it } from "vitest";
import { STUDY_PREFIX, base64OfText, safeStudyFilename, studyObjectName } from "../studyDocuments";
import { safeObjectName } from "../../../supabase/functions/_shared/firebaseServer.ts";

const AT = new Date("2026-09-05T08:15:00.000Z");
const ch = String.fromCharCode;

describe("every name this builds is one the server accepts", () => {
  // The contract that matters: the client scrubs, the server refuses, and the
  // two must not disagree — a name this produces that the server drops is a
  // document silently not kept.
  it.each([
    "beach day.jpg",
    "Screenshot 2026-09-05 at 10.13.45.png",
    "WhatsApp Image 2026-09-05 (1).jpeg",
    "R" + ch(0xe9) + "sum" + ch(0xe9) + ".pdf",
    "गणित-अध्याय-3.pdf",
    "../../etc/passwd",
    "..",
    "",
    "   ",
    "x".repeat(400),
    ch(0) + "null.jpg",
    ch(0x202e) + "gpj.exe",
  ])("round-trips %j through safeObjectName", (name) => {
    const built = studyObjectName(AT, name);
    expect(safeObjectName(built), built).toBe(built);
    expect(built.split("/")).toHaveLength(3);
    expect(built.startsWith(`${STUDY_PREFIX}/2026-09-05/081500-`)).toBe(true);
  });
});

describe("names stay recognisable and unique", () => {
  it("keeps an ordinary filename readable", () => {
    expect(studyObjectName(AT, "beach day.jpg")).toBe("study/2026-09-05/081500-beach day.jpg");
  });

  it("groups by day, so a year of worksheets is not one directory", () => {
    const a = studyObjectName(new Date("2026-09-05T23:59:59Z"), "a.pdf");
    const b = studyObjectName(new Date("2026-09-06T00:00:01Z"), "a.pdf");
    expect(a.split("/")[1]).not.toBe(b.split("/")[1]);
  });

  it("two files with the same name at different times do not collide", () => {
    const a = studyObjectName(new Date("2026-09-05T08:15:00Z"), "IMG_0001.JPG");
    const b = studyObjectName(new Date("2026-09-05T08:15:01Z"), "IMG_0001.JPG");
    expect(a).not.toBe(b);
  });

  it("never yields an empty name", () => {
    for (const empty of ["", "   ", "...", null, undefined, 42]) {
      expect(safeStudyFilename(empty).length).toBeGreaterThan(0);
    }
  });

  it("scrubs rather than refuses, because the alternative is losing the file", () => {
    // The server's job is to refuse; this side's job is to make refusing
    // unnecessary. A student with a Devanagari filename still gets it kept.
    expect(safeStudyFilename("गणित.pdf")).not.toBe("file");
    expect(safeStudyFilename("गणित.pdf")).toContain(".pdf");
  });
});

describe("text attachments become bytes correctly", () => {
  it("round-trips ASCII and non-ASCII", () => {
    for (const text of ["hello", "गणित अध्याय 3", "caf" + ch(0xe9), ""]) {
      const b64 = base64OfText(text);
      const back = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      expect(back).toBe(text);
    }
  });
});

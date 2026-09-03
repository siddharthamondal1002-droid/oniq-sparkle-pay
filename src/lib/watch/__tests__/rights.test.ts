import { describe, expect, it } from "vitest";
import { classifyArchiveRights, rightsFromStored, rightsNote } from "@/lib/watch/rights";

const now = new Date("2026-09-03T12:00:00Z");

describe("classifyArchiveRights — conservative by construction", () => {
  it("reads CC0 and the Public Domain Mark as public domain", () => {
    expect(
      classifyArchiveRights(
        { licenseurl: "http://creativecommons.org/publicdomain/zero/1.0/" },
        now,
      ).class,
    ).toBe("public_domain");
    expect(
      classifyArchiveRights(
        { licenseurl: "https://creativecommons.org/publicdomain/mark/1.0/" },
        now,
      ),
    ).toMatchObject({
      class: "public_domain",
      reuse: true,
      source: "licenseurl",
    });
  });

  it("reads a Creative Commons licence, carrying its terms", () => {
    const r = classifyArchiveRights(
      { licenseurl: "http://creativecommons.org/licenses/by-nc-nd/3.0/" },
      now,
    );
    expect(r.class).toBe("creative_commons");
    expect(r.reuse).toBe(true);
    expect(r.label).toContain("BY-NC-ND");
  });

  it("reads an explicit public-domain rights statement", () => {
    expect(classifyArchiveRights({ rights: "Public Domain" }, now).class).toBe("public_domain");
    expect(classifyArchiveRights({ possibleCopyrightStatus: "NOT_IN_COPYRIGHT" }, now).class).toBe(
      "public_domain",
    );
  });

  it("does not call an old, unlabelled film public domain", () => {
    const r = classifyArchiveRights({}, now);
    expect(r.class).toBe("unknown");
    expect(r.reuse).toBe(false);
    expect(r.label).toBe("Rights unclear");
    expect(rightsNote(r)).toContain("do not assume");
  });

  it("does not read an unrelated licence URL as permission", () => {
    expect(classifyArchiveRights({ licenseurl: "https://example.com/terms" }, now).class).toBe(
      "unknown",
    );
  });

  it("reads a stored blob defensively", () => {
    expect(rightsFromStored(null)).toBeNull();
    expect(rightsFromStored({ class: "bogus", reuse: true })?.reuse).toBe(false);
    expect(rightsFromStored({ class: "public_domain", reuse: true })?.label).toBe("Public domain");
    expect(rightsNote(null)).toContain("does not establish permission");
  });
});

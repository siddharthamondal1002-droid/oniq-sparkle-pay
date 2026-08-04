import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ATTRIBUTIONS,
  INDEPENDENCE_DISCLAIMER,
  INSTITUTION_SOURCE_TO_ATTRIBUTION,
  LICENCE_FAMILIES,
  getAttribution,
} from "@/data/attributions";
import { INSTITUTIONS } from "@/data/institutions";

const COMMON_CORE_NOTICE =
  "© Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.";
const OGL_NOTICE =
  "Contains public sector information licensed under the Open Government Licence v3.0.";

const ROUTE_SRC = readFileSync("src/routes/_authenticated/app.attributions.tsx", "utf8");
const DATA_SRC = readFileSync("src/data/attributions.ts", "utf8");

describe("attributions registry (Phase 7)", () => {
  it("every entry is structurally complete with https links", () => {
    const ids = ATTRIBUTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of ATTRIBUTIONS) {
      expect(a.usedFor.trim().length, a.id).toBeGreaterThan(0);
      expect(a.licence.trim().length, a.id).toBeGreaterThan(0);
      expect(a.licenceUrl, a.id).toMatch(/^https:\/\//);
      expect(a.sourceUrl, a.id).toMatch(/^https:\/\//);
      expect(Array.isArray(a.exclusions), a.id).toBe(true);
    }
  });

  it("every entry appears in exactly one licence family", () => {
    const grouped = LICENCE_FAMILIES.flatMap((f) => f.ids);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(ATTRIBUTIONS.map((a) => a.id).sort());
  });

  it("the Common Core notice is verbatim, character for character", () => {
    const cc = getAttribution("common-core")!;
    expect(cc.requiredNotice).toBe(COMMON_CORE_NOTICE);
    expect(cc.requiredNotice!.length).toBe(COMMON_CORE_NOTICE.length);
  });

  it("the OGL notice is verbatim", () => {
    expect(getAttribution("uk-national-curriculum")!.requiredNotice).toBe(OGL_NOTICE);
  });

  it("the HESA attribution is exactly the string HESA requires", () => {
    expect(getAttribution("hesa-discover-uni")!.requiredNotice).toBe("HESA, www.hesa.ac.uk");
  });

  it("ACARA is not presented as unconditionally commercial", () => {
    const au = getAttribution("acara")!;
    expect(au.exclusions.length).toBeGreaterThanOrEqual(4);
    expect(au.exclusions.join(" ")).toContain("National Literacy Learning Progressions");
    expect(au.exclusions.join(" ")).toContain("CC BY-NC 4.0");
    expect(au.licence).not.toMatch(/^CC BY 4\.0$/);
  });

  it("College Scorecard is not called public domain; IPEDS is", () => {
    const cs = getAttribution("college-scorecard")!;
    expect(`${cs.licence} ${cs.notes ?? ""}`.toLowerCase()).not.toMatch(
      /is (?:in the )?public domain/,
    );
    expect(cs.licence.toLowerCase()).toContain("cc by");
    expect(getAttribution("ipeds")!.licence.toLowerCase()).toContain("public domain");
  });

  it("data.gov.au states that licensing is per dataset", () => {
    const au = getAttribution("data-gov-au")!;
    const hay = `${au.licence} ${au.notes ?? ""} ${au.exclusions.join(" ")}`.toLowerCase();
    expect(hay).toContain("per dataset");
    expect(hay).toContain("not blanket cc by");
  });

  it("ROR's credit is described as a courtesy, not a licence condition", () => {
    const ror = getAttribution("ror")!;
    expect(ror.requiredNotice).toBeNull();
    expect((ror.notes ?? "").toLowerCase()).toContain("courtesy");
  });

  it("reconciles with institutions.ts — every source in use is credited", () => {
    const used = new Set(INSTITUTIONS.map((i) => i.source));
    for (const source of used) {
      expect(source in INSTITUTION_SOURCE_TO_ATTRIBUTION, source).toBe(true);
      const id = INSTITUTION_SOURCE_TO_ATTRIBUTION[source];
      if (id === null) continue; // hand-curated is ONIQ's own work
      expect(getAttribution(id!), `${source} -> ${id}`).toBeTruthy();
    }
  });

  it("mapped sources that ship no rows say so rather than implying we do", () => {
    const used = new Set(INSTITUTIONS.map((i) => i.source));
    for (const [source, id] of Object.entries(INSTITUTION_SOURCE_TO_ATTRIBUTION)) {
      if (id === null || used.has(source as never)) continue;
      const entry = getAttribution(id)!;
      expect((entry.notes ?? "").toLowerCase(), id).toContain("not currently the source");
    }
  });

  it("the independence disclaimer is present and rendered", () => {
    expect(INDEPENDENCE_DISCLAIMER).toContain("not affiliated with, endorsed by, or approved by");
    expect(ROUTE_SRC).toContain("INDEPENDENCE_DISCLAIMER");
  });

  it("never describes ONIQ as endorsed, official or approved by any body", () => {
    const prose = [
      ...ATTRIBUTIONS.flatMap((a) => [a.usedFor, a.licence, a.notes ?? "", ...a.exclusions]),
      DATA_SRC,
      ROUTE_SRC,
    ]
      .join("\n")
      .toLowerCase();
    for (const bad of [
      "oniq is endorsed",
      "oniq is official",
      "oniq is approved",
      "officially endorsed",
      "official partner",
      "approved by acara",
      "endorsed by hesa",
    ]) {
      expect(prose.includes(bad), bad).toBe(false);
    }
  });
});

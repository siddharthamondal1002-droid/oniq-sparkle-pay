import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import {
  EDU_SYSTEMS,
  canRenderSystemSourceContent,
  eduSystemsFor,
  getEduSystem,
  type EduSystem,
} from "@/data/eduSystems";

const COMMON_CORE_NOTICE =
  "© Copyright 2010. National Governors Association Center for Best Practices and Council of Chief State School Officers. All rights reserved.";

describe("education system registry (Phase 1)", () => {
  it("ids are unique and every entry is structurally complete", () => {
    const ids = EDU_SYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of EDU_SYSTEMS) {
      expect(s.authority.length, s.id).toBeGreaterThan(0);
      expect(s.stageModel.stages.length, s.id).toBeGreaterThan(0);
      expect(s.subjects.length, s.id).toBeGreaterThan(0);
      expect(s.sourceUrl, s.id).toMatch(/^https:\/\//);
      expect(s.licence.name.length, s.id).toBeGreaterThan(0);
      expect(s.licence.scope.length, s.id).toBeGreaterThan(0);
      expect(Array.isArray(s.licence.exclusions), s.id).toBe(true);
      expect(getEduSystem(s.id), s.id).toBe(s);
    }
  });

  it("every country has at least one covering system", () => {
    for (const c of ALL_COUNTRIES) {
      expect(eduSystemsFor(c).length, c).toBeGreaterThan(0);
    }
  });

  it("refuses to render source content for a non-commercial licence", () => {
    const restricted: EduSystem = {
      ...EDU_SYSTEMS[0],
      id: "synthetic-restricted",
      licence: { ...EDU_SYSTEMS[0].licence, commercialOk: false },
    };
    expect(canRenderSystemSourceContent(restricted)).toBe(false);
    expect(canRenderSystemSourceContent(getEduSystem("gb-national-curriculum")!)).toBe(true);
  });

  it("no seeded entry is commercially restricted — nothing restricted was ingested", () => {
    for (const s of EDU_SYSTEMS) {
      expect(s.licence.commercialOk, s.id).toBe(true);
      expect(canRenderSystemSourceContent(s), s.id).toBe(true);
    }
  });

  it("Common Core's verbatim notice is present with its exclusions documented", () => {
    const us = getEduSystem("us-state-standards")!;
    expect(us.licence.requiredNotice).toBe(COMMON_CORE_NOTICE);
    for (const s of EDU_SYSTEMS.filter((s) => s.licence.requiredNotice)) {
      if (s.id === "gb-national-curriculum") continue; // OGL notice, no carve-outs
      expect(s.licence.exclusions.length, s.id).toBeGreaterThan(0);
    }
  });

  it("ACARA's real carve-outs are modelled, not blanket-permissive", () => {
    const au = getEduSystem("au-acara")!;
    expect(au.licence.exclusions.join(" ")).toContain("National Literacy Learning Progressions");
    expect(au.licence.exclusions.length).toBeGreaterThanOrEqual(4);
  });

  it("the UAE is a curriculum chooser, not a single country page", () => {
    for (const id of ["gb-national-curriculum", "us-state-standards", "in-school-boards"]) {
      expect(getEduSystem(id)!.countries, id).toContain("AE");
    }
    const moe = getEduSystem("uae-moe")!;
    expect(moe.countries).toEqual(["AE"]);
    expect(moe.type).toBe("NATIONAL_CURRICULUM");
  });

  it("contains no College Board (AP/SAT) sourced system, ever", () => {
    for (const s of EDU_SYSTEMS) {
      const hay = `${s.id} ${s.authority} ${s.sourceUrl}`.toLowerCase();
      for (const bad of ["college board", "collegeboard", "advanced placement", "sat "]) {
        expect(hay.includes(bad), `${s.id} vs ${bad}`).toBe(false);
      }
    }
  });
});

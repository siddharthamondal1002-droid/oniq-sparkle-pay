/**
 * Job-scam alerts: every market reachable, every warning attributed, and the
 * reporting channel that works from where the user is standing.
 *
 * The axis matters more here than almost anywhere else in the app. An Indian
 * user in Dubai who is being scammed right now needs Dubai Police eCrime;
 * 1930 will not help them today.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_COUNTRIES } from "@/data/appRegistry";
import {
  LEAD_WARNING,
  REPORTING,
  SCAM_PATTERNS,
  SOURCES,
  reportingFor,
  sourceFor,
} from "@/data/jobScamAlerts";

describe("every market can report", () => {
  it("has at least one reporting channel per country", () => {
    for (const c of ALL_COUNTRIES) {
      expect(REPORTING[c]?.length, `${c} has nowhere to report`).toBeGreaterThan(0);
    }
  });

  it("every channel is reachable — a phone number or a URL, never neither", () => {
    for (const c of ALL_COUNTRIES) {
      for (const ch of REPORTING[c]) {
        expect(ch.phone || ch.url, `${c}/${ch.name} is unreachable`).toBeTruthy();
        if (ch.url) expect(ch.url).toMatch(/^https:\/\//);
        if (ch.phone) expect(ch.phone, `${c}/${ch.name} phone must be digits only`).toMatch(/^\d+$/);
      }
    }
  });

  it("carries the specific channels each jurisdiction actually uses", () => {
    expect(JSON.stringify(REPORTING.IN)).toContain("1930");
    expect(JSON.stringify(REPORTING.IN)).toContain("cybercrime.gov.in");
    expect(JSON.stringify(REPORTING.US)).toContain("reportfraud.ftc.gov");
    expect(JSON.stringify(REPORTING.US)).toContain("ic3.gov");
    expect(JSON.stringify(REPORTING.GB)).toContain("actionfraud");
    expect(JSON.stringify(REPORTING.CA)).toContain("antifraudcentre");
    expect(JSON.stringify(REPORTING.AU)).toContain("scamwatch.gov.au");
    expect(JSON.stringify(REPORTING.SG)).toContain("1799");
    expect(JSON.stringify(REPORTING.AE)).toContain("ecrime.ae");
  });
});

describe("axis is where the user is standing", () => {
  it("prefers current region over home", () => {
    const inDubai = reportingFor("AE", "IN");
    expect(JSON.stringify(inDubai)).toContain("ecrime.ae");
    expect(JSON.stringify(inDubai)).not.toContain("1930");
  });

  it("falls back to home when the region is unknown", () => {
    expect(JSON.stringify(reportingFor(null, "IN"))).toContain("1930");
  });

  it("returns nothing rather than a wrong number when neither is known", () => {
    expect(reportingFor(null, null)).toEqual([]);
    expect(sourceFor(null, null)).toBeNull();
  });
});

describe("attribution", () => {
  it("names an authority and links it for every country", () => {
    for (const c of ALL_COUNTRIES) {
      const s = SOURCES[c];
      expect(s, `${c} has no source`).toBeDefined();
      expect(s.authority.length).toBeGreaterThan(5);
      expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it("does not re-host a government dataset — links only", () => {
    // Code lines only. The file's own header says "Government datasets are NOT
    // re-hosted", and a prose match on that would be a false positive — the
    // first version of this test caught exactly that.
    const code = readFileSync(join(process.cwd(), "src/data/jobScamAlerts.ts"), "utf8")
      .split("\n")
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    expect(code).not.toMatch(/\.csv|\.json"|fetch\(|download\(/i);
  });
});

describe("the warning itself", () => {
  it("leads with the one rule that catches every version of this", () => {
    expect(LEAD_WARNING.toLowerCase()).toContain("charges you to get paid");
  });

  it("describes the task scam as a sequence, because step 3 is the save", () => {
    const task = SCAM_PATTERNS.find((p) => p.id === "task-scam");
    expect(task).toBeDefined();
    expect(task!.steps.length).toBeGreaterThanOrEqual(4);
    const blob = task!.steps.join(" ").toLowerCase();
    expect(blob).toContain("whatsapp");
    expect(blob).toContain("deposit");
  });

  it("gives every pattern a tell the reader can act on", () => {
    for (const p of SCAM_PATTERNS) {
      expect(p.tell.length, `${p.id} has no tell`).toBeGreaterThan(20);
      expect(p.steps.length).toBeGreaterThan(2);
    }
  });
});

/**
 * Google Play policy, as tests rather than intentions.
 *
 * Play is the nearest-term risk in this loop — faster and blunter than any
 * regulator, and a removal is not appealable on a useful timescale. These
 * cover the three policies that actually bite an app shaped like ONIQ.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_SURFACES,
  ALLOWED_REMOTE_IMAGE_HOSTS,
  NATIVE_CAPABILITIES,
  THIRD_PARTY_REQUESTS,
} from "@/config/playCompliance";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const tsxFiles = walk(join(ROOT, "src")).filter((p) => !p.includes("__tests__"));

describe("AI-Generated Content policy", () => {
  it.each(AI_SURFACES.map((s) => [s.screen, s.file, s.id] as const))(
    "%s labels its output and can be reported in-app",
    (_screen, file, id) => {
      const src = readFileSync(join(ROOT, file), "utf8");
      expect(src, `${file} does not render AiOutputReport`).toMatch(/AiOutputReport/);
      expect(src, `${file} does not pass surface="${id}"`).toContain(id);
      expect(src, `${file} does not label the output`).toMatch(/AI_OUTPUT_LABEL|AI-generated/);
    },
  );

  it("reporting never sends the user out of the app", () => {
    const src = readFileSync(join(ROOT, "src/components/safety/AiOutputReport.tsx"), "utf8");
    // A mailto: or an external link here would fail the policy outright.
    expect(src).not.toMatch(/mailto:|window\.open|href=/);
    expect(src).toMatch(/from\("reports"\)|from\(.reports.\)/);
  });

  it("every generative surface in the app is declared, none missed", () => {
    // A file that renders AI output but is absent from AI_SURFACES is the
    // failure mode: shipped, unlabelled, unreportable.
    const declared = new Set(AI_SURFACES.map((s) => join(ROOT, s.file)));
    const renderers = tsxFiles.filter((p) => /AiOutputReport/.test(readFileSync(p, "utf8")));
    const undeclared = renderers
      .filter(
        (p) =>
          !declared.has(p) &&
          !p.endsWith("AiOutputReport.tsx") &&
          // playCompliance.ts names the component in order to require it.
          !p.endsWith("playCompliance.ts"),
      )
      .map((p) => p.slice(ROOT.length + 1));
    expect(undeclared).toEqual([]);
  });
});

describe("no third-party logos", () => {
  it("loads no remote image from an undeclared host", () => {
    const offenders: string[] = [];
    for (const p of tsxFiles) {
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/src\s*=\s*["'`](https:\/\/[^"'`]+)["'`]/g)) {
        const host = new URL(m[1]).host;
        if (!(ALLOWED_REMOTE_IMAGE_HOSTS as readonly string[]).includes(host)) {
          offenders.push(`${p.slice(ROOT.length + 1)} -> ${host}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares the one vendor mark it does show", () => {
    expect(ALLOWED_REMOTE_IMAGE_HOSTS).toContain("images.dmca.com");
  });
});

describe("Data safety declaration matches reality", () => {
  it("declares every third-party host the app itself calls", () => {
    // The distinction that matters, and that the first version of this test
    // got wrong: a URL the user TAPS is not a request the app MAKES. The
    // registries hold 400+ link-out destinations — Swiggy, Uber, every
    // university — and none of them contacts anything until a user chooses to
    // go there. Data safety covers what the app sends on its own initiative.
    //
    // So scan only positions that fire without user choice: fetch(), an
    // <img src>, an <iframe src> and a <script src>.
    const declared = THIRD_PARTY_REQUESTS.map((r) => r.host).join(" ");
    const AUTOMATIC = [
      /fetch\(\s*[`"'](https:\/\/[^`"']+)/g,
      /src\s*=\s*[{]?[`"'](https:\/\/[^`"']+)/g,
      /\.src\s*=\s*[`"'](https:\/\/[^`"']+)/g,
    ];
    const hosts = new Set<string>();
    for (const p of tsxFiles) {
      const text = readFileSync(p, "utf8");
      for (const re of AUTOMATIC) {
        for (const m of text.matchAll(re)) {
          const h = new URL(m[1]).host.toLowerCase();
          if (h.includes("supabase") || h.includes("oniqhub") || h.includes("lovable")) continue;
          hosts.add(h);
        }
      }
    }
    const undeclared = [...hosts].filter(
      (h) =>
        !declared.includes(h) &&
        // Fonts are declared in the root <head>, not fired from a component.
        !/fonts\.(googleapis|gstatic)\.com/.test(h),
    );
    expect(undeclared, `undeclared third-party host(s): ${undeclared.join(", ")}`).toEqual([]);
  });

  it("says what each request sends and whether it is avoidable", () => {
    for (const r of THIRD_PARTY_REQUESTS) {
      expect(r.sends.length, `${r.host}`).toBeGreaterThan(15);
      expect(r.purpose.length, `${r.host}`).toBeGreaterThan(15);
      expect(typeof r.avoidable).toBe("boolean");
    }
  });

  it("flags the badge as avoidable, because it is", () => {
    const badge = THIRD_PARTY_REQUESTS.find((r) => r.host === "images.dmca.com");
    expect(badge?.avoidable).toBe(true);
  });
});

describe("Minimum Functionality", () => {
  it("records enough native capability to answer a webview-spam review", () => {
    expect(NATIVE_CAPABILITIES.length).toBeGreaterThanOrEqual(8);
    for (const c of NATIVE_CAPABILITIES) expect(c.length).toBeGreaterThan(40);
  });

  it("labels link-outs as leaving the app", () => {
    // Sampled on the two newest link-out surfaces; both must say so in the
    // visible label and in the accessible name.
    for (const f of [
      "src/routes/_authenticated/app.jobs-apps.tsx",
    ]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} does not label its link-outs`).toMatch(
        /Open in browser|opens outside ONIQ|Open ↗/,
      );
    }
  });
});

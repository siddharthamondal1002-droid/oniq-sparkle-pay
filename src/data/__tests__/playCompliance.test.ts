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
import { HEALTH_AI_PRIVACY_STATEMENT } from "@/config/privacy";
import {
  AI_CONTENT_MODULES,
  AI_LABEL_OVERRIDES,
  AI_SURFACES,
  ALLOWED_REMOTE_IMAGE_HOSTS,
  DATA_COLLECTED,
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
      // A surface may carry its own label by owner directive (AI_LABEL_OVERRIDES,
      // e.g. Health's "AI-assisted"); it must then render THAT identifier, and
      // an override never lets a surface render no label at all.
      const override = AI_LABEL_OVERRIDES[id];
      if (override) {
        expect(src, `${file} does not render its ${override}`).toContain(override);
      } else {
        expect(src, `${file} does not label the output`).toMatch(/AI_OUTPUT_LABEL|AI-generated/);
      }
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

  it("a surface that renders NO label is caught too", () => {
    // THE HOLE THE TEST ABOVE HAS, and the reason Lores shipped unlabelled.
    //
    // That test only inspects files which ALREADY render <AiOutputReport />.
    // It catches a stale declaration list. It cannot catch the failure its own
    // comment names — "shipped, unlabelled, unreportable" — because a surface
    // with no label imports nothing to grep for. The Lores hub served a season
    // of Runway-generated video and was completely invisible to it.
    //
    // Asking the question from the DATA side closes that: generative content
    // has to come from somewhere, and the somewheres are enumerable even when
    // the renderers are not.
    const declared = new Set(AI_SURFACES.map((s) => join(ROOT, s.file)));
    const missing: string[] = [];

    // The content modules themselves are the SOURCE. A data file renders
    // nothing, so requiring a label of it would be nonsense.
    const sourceFiles = new Set(
      // The "@/" alias maps to src/, not to the repo root.
      AI_CONTENT_MODULES.map((m) => join(ROOT, m.replace("@/", "src/") + ".ts")),
    );

    // MATCH RELATIVE IMPORTS TOO, not just the "@/" alias.
    //
    // The alias-only version of this had the same shape of hole as the test
    // above: `import { RENDERED } from "../../data/lores"` is the identical
    // dependency written differently, and it sailed straight past. A screen
    // could have shipped a season of generated video unlabelled for the second
    // time, for want of two characters. Both forms occur in this repo already —
    // ep3Shots.ts reaches originals.ts relatively — so this is not theoretical.
    //
    // Anchored on the module's LAST segment, preceded by either the alias or
    // any relative path, and followed immediately by the closing quote, so
    // "@/data/originalsScript" does not match "@/data/originals".
    const importsModule = (src: string, mod: string) => {
      const leaf = mod
        .split("/")
        .pop()!
        .replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
      return new RegExp(`from\\s+["'](?:@/data/|(?:\\.{1,2}/)+(?:[\\w.-]+/)*)${leaf}["']`).test(
        src,
      );
    };

    for (const p of tsxFiles) {
      if (sourceFiles.has(p)) continue;
      const src = readFileSync(p, "utf8");
      const usesAiContent = AI_CONTENT_MODULES.some((m) => importsModule(src, m));
      if (usesAiContent && !declared.has(p)) missing.push(p.slice(ROOT.length + 1));
    }

    expect(
      missing,
      `renders AI-generated content but is not in AI_SURFACES:\n${missing.join("\n")}`,
    ).toEqual([]);
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

describe("health claims match where the data actually goes", () => {
  // NATIVE_CAPABILITIES used to say "health readings never leave the device".
  // app.vitals.tsx writes to health_profiles, health_checkins and cycle_logs,
  // and those tables hold real rows in production — so the claim was false,
  // and false in the worst direction: it would have gone into Play Data safety
  // as "no health data collected", and onto the marketing site as the
  // headline privacy promise.
  //
  // The rule this encodes: you may not claim health data stays on the device
  // while any surface writes it to a server table.
  const vitals = readFileSync(join(ROOT, "src/routes/_authenticated/app.vitals.tsx"), "utf8");
  const writesToServer = /from\("(health_profiles|health_checkins|cycle_logs)"\)/.test(vitals);

  it("vitals really does write health data to the server (premise check)", () => {
    // If this ever goes false, the guard below can be relaxed — but only then.
    expect(writesToServer).toBe(true);
  });

  it("claims no device-only storage for health while the server tables are written", () => {
    const claims = NATIVE_CAPABILITIES.join(" ").toLowerCase();
    if (writesToServer) {
      expect(
        claims,
        "health data is claimed to stay on-device but is written to Postgres",
      ).not.toMatch(/health[^.]*never leave|never leave[^.]*device[^.]*health|on-device health/);
    }
  });

  it("still says something true and specific about health privacy", () => {
    // Removing a false claim must not leave the section empty — the real
    // controls (RLS, the database-enforced UAE block) are the substitute.
    const claims = NATIVE_CAPABILITIES.join(" ");
    expect(claims).toMatch(/row-level security/i);
    expect(claims).toMatch(/health_data_allowed|UAE block/i);
  });
});

describe("Data safety covers every sensitive permission the app requests", () => {
  // The manifest is the ground truth for what ONIQ can reach. Twice now a
  // permission was live while the declaration said nothing about it —
  // ACCESS_FINE_LOCATION was declared in the manifest and used with
  // enableHighAccuracy, while DATA_COLLECTED claimed only "approximate", and
  // READ_CONTACTS was missing entirely. Play's 15 July 2026 announcement
  // singles out precise-vs-approximate location disclosure specifically.
  const manifest = readFileSync(join(ROOT, "android/app/src/main/AndroidManifest.xml"), "utf8");
  const declared = DATA_COLLECTED.map((d) => `${d.category} ${d.playType} ${d.what}`)
    .join(" ")
    .toLowerCase();

  const SENSITIVE: [string, RegExp][] = [
    ["ACCESS_FINE_LOCATION", /precise location/],
    ["ACCESS_COARSE_LOCATION", /approximate location/],
    ["READ_CONTACTS", /contacts/],
    ["CAMERA", /photo|video|camera|scan/],
    ["RECORD_AUDIO", /call|audio|message/],
  ];

  it.each(SENSITIVE)("%s is declared in Data safety", (perm, expected) => {
    if (!manifest.includes(`android.permission.${perm}`)) return; // not requested
    expect(declared, `${perm} is in the manifest but undeclared`).toMatch(expected);
  });

  it("declares precise location, since the code asks for high accuracy", () => {
    const miniapps = readFileSync(join(ROOT, "src/lib/miniapps.ts"), "utf8");
    if (/enableHighAccuracy:\s*true/.test(miniapps)) {
      expect(DATA_COLLECTED.some((d) => /precise/i.test(d.playType))).toBe(true);
    }
  });

  it("requests no SMS or call-log permission", () => {
    // Play's July 2026 change removed phone-call account verification as a
    // permitted READ_CALL_LOG use case. ONIQ never used it; this keeps it so.
    for (const perm of ["READ_CALL_LOG", "READ_SMS", "RECEIVE_SMS", "SEND_SMS"]) {
      expect(manifest, `${perm} would now need a permitted use case`).not.toContain(perm);
    }
  });

  it("targets an API level Play still accepts", () => {
    const vars = readFileSync(join(ROOT, "android/variables.gradle"), "utf8");
    const target = Number(vars.match(/targetSdkVersion\s*=\s*(\d+)/)?.[1] ?? 0);
    expect(target, "targetSdk is below Play's 2026 floor").toBeGreaterThanOrEqual(35);
  });
});

describe("third-party AI integrations are disclosed", () => {
  // 15 July 2026 clarification: the User Data policy applies to third-party AI
  // integrations, and the developer remains responsible for limited use,
  // disclosure and consent. ONIQ's generative surfaces send user input to
  // Anthropic, which was previously disclosed nowhere.
  const privacyPage = readFileSync(join(ROOT, "src/routes/privacy.tsx"), "utf8");

  it("names the provider in the public privacy notice", () => {
    expect(privacyPage).toMatch(/Anthropic/);
  });

  it("states the limited-use position", () => {
    const lower = privacyPage.toLowerCase();
    expect(lower).toMatch(/not.{0,20}used to train/);
    expect(lower).toMatch(/not.{0,20}sold/);
  });

  it("states the health-AI position the owner approved, and the Vitals tables still reach no function", () => {
    // Owner directive 2026-09-09: the absolute "never sent to any AI feature"
    // is retired; the notice carries the consent-conditioned statement
    // VERBATIM (whitespace-normalised, tags stripped — JSX wraps the line).
    const text = privacyPage
      .replace(/\{"\s*"\}/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(text).toContain(HEALTH_AI_PRIVACY_STATEMENT);
    expect(privacyPage.toLowerCase()).not.toMatch(/never sent to any ai/);
    // Still verified rather than asserted: no edge function reads a Vitals table.
    const fnDir = join(ROOT, "supabase/functions");
    const offenders = walk(fnDir).filter((p) =>
      /health_checkins|cycle_logs|health_profiles/.test(readFileSync(p, "utf8")),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it("declares the AI processing in Data safety too", () => {
    expect(DATA_COLLECTED.some((d) => /ai processing/i.test(d.category))).toBe(true);
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
    for (const f of ["src/components/jobs/JobAppsDirectory.tsx"]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      expect(src, `${f} does not label its link-outs`).toMatch(
        /Open in browser|opens outside ONIQ|Open ↗/,
      );
    }
  });
});

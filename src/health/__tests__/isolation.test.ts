/**
 * THE HEALTH DOMAIN IS SEALED.
 *
 * Owner brief, 2026-09-08: health records must never enter unrelated AI
 * prompts, analytics, logs, telemetry or notifications. The mechanism is a
 * module boundary; this is the enumeration that makes it a red test rather
 * than a convention. It walks the whole tree, comments stripped — good
 * comments quote the code they discuss, and a grep that reads them has been
 * fooled seven times in this repo.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRY_REGISTRY, isHealthDataAllowed } from "@/data/countryRegistry";
import { stripComments } from "@/test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");

const HEALTH_NAMES =
  /\b(health_records|health_documents|health_consents|health_audit|health_config|health_retention_policies)\b|health-documents|"health-api"/;

/** The only places allowed to name a health table, the bucket or the function. */
const ALLOWED = [
  "src/health/",
  "src/routes/_authenticated/app.health",
  "supabase/functions/health-api/",
  "supabase/functions/_shared/health/",
  "supabase/functions/_shared/purgeUserData.ts",
  "src/integrations/supabase/types.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".gen.ts")
    ) {
      out.push(p);
    }
  }
  return out;
}

const FILES = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "supabase", "functions"))];
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");
const naming = FILES.filter((p) => HEALTH_NAMES.test(stripComments(readFileSync(p, "utf8")))).map(
  rel,
);

describe("who may name the health tables", () => {
  it("finds the module itself, so the walk is not vacuous", () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(naming).toContain("src/health/api.ts");
    expect(naming).toContain("supabase/functions/health-api/index.ts");
    expect(naming).toContain("supabase/functions/_shared/purgeUserData.ts");
  });

  it("nobody outside the allowed paths", () => {
    const outside = naming.filter((f) => !ALLOWED.some((a) => f.startsWith(a)));
    expect(outside, "health tables named outside the health module").toEqual([]);
  });

  it("no other edge function — not llm.ts, not a study or chat function", () => {
    const fns = naming.filter((f) => f.startsWith("supabase/functions/"));
    for (const f of fns) {
      expect(
        f.startsWith("supabase/functions/health-api/") ||
          f.startsWith("supabase/functions/_shared/health/") ||
          f === "supabase/functions/_shared/purgeUserData.ts",
        f,
      ).toBe(true);
    }
  });
});

describe("Phase 1 reaches no model and no Google", () => {
  const fn = stripComments(
    readFileSync(join(ROOT, "supabase/functions/health-api/index.ts"), "utf8"),
  );

  it("calls no AI helper and names no provider host", () => {
    expect(fn).not.toMatch(/callGemini\(|callClaude\(|callText\(/);
    expect(fn).not.toMatch(
      /generativelanguage|anthropic|aiplatform|healthcare\.googleapis|openai/i,
    );
    expect(fn).not.toMatch(/\bfetch\(/);
  });

  it("logs through one redacted line and nothing else", () => {
    expect(fn.match(/console\./g)?.length ?? 0).toBe(1);
    expect(fn).toMatch(/console\.log\(JSON\.stringify\(redactForLog\(/);
  });

  it("never logs or returns the request body wholesale", () => {
    expect(fn).not.toMatch(/logSafe\(\s*body/);
    expect(fn).not.toMatch(/ok\(ctx,\s*body\)/);
  });
});

describe("notifications know nothing about health", () => {
  it("send-push and push.ts carry no health kind", () => {
    for (const f of ["supabase/functions/send-push/index.ts", "src/lib/push.ts"]) {
      const src = stripComments(readFileSync(join(ROOT, f), "utf8"));
      expect(src, f).not.toMatch(/health/i);
    }
  });
});

describe("the region axis agrees with the country registry", () => {
  it("HEALTH_BLOCKED_REGIONS is exactly the set the registry disallows", () => {
    const fn = stripComments(
      readFileSync(join(ROOT, "supabase/functions/health-api/index.ts"), "utf8"),
    );
    const m = fn.match(/const HEALTH_BLOCKED_REGIONS = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const listed = [...m![1].matchAll(/"([A-Z]{2})"/g)].map((x) => x[1]).sort();
    const disallowed = (Object.keys(COUNTRY_REGISTRY) as Array<keyof typeof COUNTRY_REGISTRY>)
      .filter((c) => !isHealthDataAllowed(c))
      .sort();
    expect(listed).toEqual(disallowed);
    expect(listed).toContain("AE");
  });
});

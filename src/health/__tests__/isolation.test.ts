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
import { stripComments, stripSqlComments } from "@/test/sourceText";

const ROOT = join(__dirname, "..", "..", "..");

/** The seven tables, the bucket and the two functions. Derived from the migrations below. */
const HEALTH_TABLES = [
  "health_records",
  "health_documents",
  "health_consents",
  "health_audit",
  "health_config",
  "health_retention_policies",
  "health_ai_requests",
];
const HEALTH_NAMES = new RegExp(
  `\\b(${HEALTH_TABLES.join("|")})\\b|health-documents|"health-api"|"health-ai"`,
);

/** The only places allowed to name a health table, the bucket or a function. */
const ALLOWED = [
  "src/health/",
  "src/routes/_authenticated/app.health",
  "src/routes/_authenticated/app.admin_.health-ai.tsx",
  "supabase/functions/health-api/",
  "supabase/functions/health-ai/",
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
    expect(naming).toContain("supabase/functions/health-ai/index.ts");
    expect(naming).toContain("supabase/functions/_shared/purgeUserData.ts");
  });

  it("the sealed table list is the migrations' list, so a new table cannot escape the seal", () => {
    // Every `create table … public.health_*` across the health migrations
    // must be a name this seal knows, and vice versa.
    const migrations = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) =>
      /oniq_health_phase\d+\.sql$/.test(f),
    );
    expect(migrations.length).toBeGreaterThanOrEqual(2);
    const created = new Set<string>();
    for (const f of migrations) {
      const sql = stripSqlComments(readFileSync(join(ROOT, "supabase", "migrations", f), "utf8"));
      for (const m of sql.matchAll(/create table if not exists public\.(health_\w+)/gi)) {
        created.add(m[1].toLowerCase());
      }
    }
    expect([...created].sort()).toEqual([...HEALTH_TABLES].sort());
  });

  it("nobody outside the allowed paths, and every allowed path is really used", () => {
    const outside = naming.filter((f) => !ALLOWED.some((a) => f.startsWith(a)));
    expect(outside, "health tables named outside the health module").toEqual([]);
    for (const a of ALLOWED) {
      // The generated Supabase types name the tables only once the migration
      // is applied and the file regenerated; until then it is allowed but empty.
      if (a === "src/integrations/supabase/types.ts") continue;
      expect(
        naming.some((f) => f.startsWith(a)),
        `${a} is allowed but nothing there names a health table — a stale entry`,
      ).toBe(true);
    }
  });

  it("no other edge function — not llm.ts, not a study or chat function", () => {
    const fns = naming.filter((f) => f.startsWith("supabase/functions/"));
    for (const f of fns) {
      expect(
        f.startsWith("supabase/functions/health-api/") ||
          f.startsWith("supabase/functions/health-ai/") ||
          f.startsWith("supabase/functions/_shared/health/") ||
          f === "supabase/functions/_shared/purgeUserData.ts",
        f,
      ).toBe(true);
    }
  });

  it("no edge function outside the two imports anything from _shared/health", () => {
    const offenders: string[] = [];
    for (const p of FILES) {
      const r = rel(p);
      if (!r.startsWith("supabase/functions/")) continue;
      if (
        r.startsWith("supabase/functions/health-api/") ||
        r.startsWith("supabase/functions/health-ai/") ||
        r.startsWith("supabase/functions/_shared/health/")
      ) {
        continue;
      }
      const src = stripComments(readFileSync(p, "utf8"));
      if (/from\s+["'][^"']*_shared\/health\//.test(src)) offenders.push(r);
    }
    expect(offenders).toEqual([]);
  });
});

describe("the health functions reach no model and no Google", () => {
  const FUNCTIONS = [
    "supabase/functions/health-api/index.ts",
    "supabase/functions/health-ai/index.ts",
  ];
  const SHARED = walk(join(ROOT, "supabase/functions/_shared/health")).map(rel);

  it.each(FUNCTIONS)("%s calls no AI helper, names no provider host, opens no socket", (f) => {
    const fn = stripComments(readFileSync(join(ROOT, f), "utf8"));
    expect(fn).not.toMatch(/callGemini\(|callClaude\(|callText\(|callGatewayText\(/);
    expect(fn).not.toMatch(
      /generativelanguage|anthropic|aiplatform|healthcare\.googleapis|openai/i,
    );
    expect(fn).not.toMatch(/\bfetch\(/);
  });

  it.each(FUNCTIONS)("%s logs through one redacted line and nothing else", (f) => {
    const fn = stripComments(readFileSync(join(ROOT, f), "utf8"));
    expect(fn.match(/console\./g)?.length ?? 0).toBe(1);
    expect(fn).toMatch(/console\.log\(JSON\.stringify\(redactForLog\(/);
  });

  it.each(FUNCTIONS)("%s never logs or returns the request body wholesale", (f) => {
    const fn = stripComments(readFileSync(join(ROOT, f), "utf8"));
    expect(fn).not.toMatch(/logSafe\(\s*body/);
    expect(fn).not.toMatch(/ok\(ctx,\s*body\)/);
  });

  it("the shared health tree logs nothing at all", () => {
    expect(SHARED.length).toBeGreaterThan(12);
    for (const f of SHARED) {
      const src = stripComments(readFileSync(join(ROOT, f), "utf8"));
      expect(src, f).not.toMatch(/console\./);
    }
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
  it.each(["health-api", "health-ai"])(
    "%s: HEALTH_BLOCKED_REGIONS is exactly the set the registry disallows",
    (name) => {
      const fn = stripComments(
        readFileSync(join(ROOT, `supabase/functions/${name}/index.ts`), "utf8"),
      );
      const m = fn.match(/const HEALTH_BLOCKED_REGIONS = \[([^\]]*)\]/);
      expect(m).toBeTruthy();
      const listed = [...m![1].matchAll(/"([A-Z]{2})"/g)].map((x) => x[1]).sort();
      const disallowed = (Object.keys(COUNTRY_REGISTRY) as Array<keyof typeof COUNTRY_REGISTRY>)
        .filter((c) => !isHealthDataAllowed(c))
        .sort();
      expect(listed).toEqual(disallowed);
      expect(listed).toContain("AE");
    },
  );
});

/**
 * HEALTH → AI DIRECT PATH = IMPOSSIBLE, as a red test.
 *
 * The registry names one provider that never leaves the process, and the
 * only way out of the health domain is an ALLOWLIST: each function
 * directory is exactly one file; a file may import the Supabase client and
 * a NAMED health sibling (a file under ai/ reaches "../" only for the
 * listed shared modules — never a wildcard); every module reachable from
 * an entrypoint, transitively, is inside _shared/health; and the source
 * with comments stripped (strings KEPT — a template literal is where the
 * first version's fetch hid) carries no fetch, no `.functions`, no dynamic
 * import, no socket, no Worker, no globalThis, no eval, no Deno API but env
 * and serve, and no rpc outside a closed list. On the client, the health
 * screens may invoke only "health-api" and "health-ai". A provider is
 * handed aliases and never an id. The privacy promise stands, and the day
 * a recipient other than ONIQ appears in RECIPIENT_FOR_PROVIDER while it
 * still stands, this fails.
 *
 * Red-teamed 2026-09-08 by mutation: four one-file edits (a fetch inside a
 * template literal in synthetic.ts; a new ai/vertex.ts importing
 * ../../fetchTimeout.ts; a new health-ai/net.ts; a bracket-accessed
 * functions["invoke"], an aliased globalThis.fetch and a Worker in
 * health-ai/index.ts) walked past the first version of this file with every
 * guard green. Each is a red test now.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executableText, stripComments } from "@/test/sourceText";
import { RECIPIENTS } from "../../domain";
import {
  AI_RECIPIENTS,
  PROVIDER_IDS,
  RECIPIENT_FOR_PROVIDER,
  TEXT_SOURCE_IDS,
} from "../../ai/types";
import {
  PROVIDER_REGISTRY,
  providerFor,
} from "../../../../supabase/functions/_shared/health/ai/provider";
import {
  NullTextSource,
  TEXT_SOURCE_REGISTRY,
  textSourceFor,
} from "../../../../supabase/functions/_shared/health/ai/textSource";
import { runHealthAi } from "../../../../supabase/functions/_shared/health/ai/gateway";
import { allHealthFlagsOff } from "../../flagNames";
import { FakeStore } from "./fakeStore";

const ROOT = join(__dirname, "..", "..", "..", "..");
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== "__tests__") walk(p, out);
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const SHARED_DIR = join(ROOT, "supabase/functions/_shared/health");
const FUNCTION_DIRS = ["health-api", "health-ai"].map((d) => join(ROOT, "supabase/functions", d));
/** The WHOLE of each function directory and the whole shared tree — not a hand-picked list. */
const SERVER_FILES = [...walk(SHARED_DIR), ...FUNCTION_DIRS.flatMap((d) => walk(d))];
/** The shared health modules a file under ai/ may reach with "../". Named, not a wildcard. */
const SHARED_SIBLINGS = [
  "adapter",
  "audit",
  "consent",
  "domain",
  "flagNames",
  "flags",
  "redact",
  "retention",
];
const CLIENT_FILES = [
  ...walk(join(ROOT, "src/health")),
  ...readdirSync(join(ROOT, "src/routes/_authenticated"))
    .filter((f) => /^app\.health.*\.tsx$|^app\.admin_\.health-ai\.tsx$/.test(f))
    .map((f) => join(ROOT, "src/routes/_authenticated", f)),
];

const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
/**
 * Scanned over stripComments output — strings KEPT — because the health
 * tree has no legitimate use of any of these, so a false positive costs
 * nothing and a masked string hid a real fetch. Identifiers, not call
 * shapes: `const f = fetch` has no `(` after the word.
 */
const EGRESS =
  /\bfetch\b|\.functions\b|functions\s*\[|\bimport\s*\(|\bWebSocket\b|\bEventSource\b|\bXMLHttpRequest\b|sendBeacon|\bWorker\b|\bglobalThis\b|\bself\b|\bnavigator\b|\beval\s*\(|\bnew Function\b|\bDeno\.(?!env\b|serve\b)/;
/** `from "x"`, `import("x")` and a bare `import "x"` — not `.from("table")`, which is a query. */
const IMPORT_SPEC =
  /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm;
const specOf = (m: RegExpMatchArray) => m[1] ?? m[2] ?? m[3];

/** Which specifiers a file at this path may import; everything else is an escape. */
function importAllowed(file: string, spec: string): boolean {
  if (spec === SUPABASE_JS) return true;
  if (!spec.startsWith("./") && !spec.startsWith("../")) return false;
  if (spec.includes("../../")) return false;
  const r = rel(file);
  const inAi = r.startsWith("supabase/functions/_shared/health/ai/");
  const inShared = !inAi && r.startsWith("supabase/functions/_shared/health/");
  if (inAi) {
    if (/^\.\/[A-Za-z]+\.ts$/.test(spec)) return true;
    const m = /^\.\.\/([A-Za-z]+)\.ts$/.exec(spec);
    return !!m && SHARED_SIBLINGS.includes(m[1]);
  }
  if (inShared) return /^\.\/(ai\/)?[A-Za-z]+\.ts$/.test(spec);
  // A function entrypoint: only the shared health tree, by full relative path.
  return /^\.\.\/_shared\/health\/(ai\/)?[A-Za-z]+\.ts$/.test(spec);
}

/** Every module reachable from `entry` through relative imports, transitively. */
function reachable(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(IMPORT_SPEC)) {
      const spec = specOf(m);
      if (!spec.startsWith(".")) continue;
      const target = resolve(dirname(f), spec);
      if (existsSync(target)) stack.push(target);
      else seen.add(target);
    }
  }
  seen.delete(entry);
  return [...seen];
}
const SERVER_RPC_ALLOWED = [
  "health_append_audit",
  "is_admin",
  "is_adult_18",
  "has_active_legal_hold",
];

describe("the registry", () => {
  it("names exactly one provider, synthetic, whose recipient is ONIQ", () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual(["synthetic"]);
    expect([...PROVIDER_IDS]).toEqual(["synthetic"]);
    expect(Object.values(RECIPIENT_FOR_PROVIDER)).toEqual(["oniq"]);
    for (const r of AI_RECIPIENTS) expect(RECIPIENTS).toContain(r);
  });

  it.each([
    "vertex",
    "gemini",
    "medgemma",
    "google_vertex",
    "openai",
    "anthropic",
    "",
    null,
    undefined,
    1,
    "SYNTHETIC",
  ])("refuses %s", (id) => {
    expect(() => providerFor(id)).toThrow(/provider_not_allowed/);
  });

  it("the factory takes no arguments and the synthetic class has no constructor options", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai/provider.ts"), "utf8"),
    );
    expect(src).toContain("synthetic: () => new SyntheticHealthAIProvider(),");
    expect(PROVIDER_REGISTRY.synthetic.length).toBe(0);
    const synth = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai/synthetic.ts"), "utf8"),
    );
    expect(synth).not.toMatch(/constructor\(/);
    expect(synth).not.toMatch(/misbehav/i);
  });

  it("nothing in the health tree writes to the price table, the allowlist, the recipient map or the registry", () => {
    // Not frozen — the tests that prove the gate/cost split mutate them on
    // purpose — so the guarantee is that no RUNTIME module ever does.
    const TABLES = /(PRICE_PER_1M|MODEL_ALLOWLIST|RECIPIENT_FOR_PROVIDER|PROVIDER_REGISTRY)/;
    for (const f of SERVER_FILES) {
      const src = stripComments(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(new RegExp(`${TABLES.source}\\s*\\[[^\\]]*\\]\\s*=[^=]`));
      expect(src, rel(f)).not.toMatch(new RegExp(`delete\\s+${TABLES.source}`));
      expect(src, rel(f)).not.toMatch(
        new RegExp(`Object\\.(assign|defineProperty)\\(\\s*${TABLES.source}`),
      );
      expect(src, rel(f)).not.toMatch(new RegExp(`${TABLES.source}\\.\\w+\\s*=[^=]`));
    }
  });

  it("registers no text source: null yields nothing, and any other id is null too", async () => {
    expect(Object.keys(TEXT_SOURCE_REGISTRY)).toEqual(["null"]);
    expect([...TEXT_SOURCE_IDS]).toEqual(["null"]);
    expect(textSourceFor("inline")).toBeInstanceOf(NullTextSource);
    expect(await textSourceFor("null").text("any")).toBeNull();
  });
});

describe("egress allowlist — server", () => {
  it("each function directory is exactly one file, and the walk found the tree", () => {
    for (const d of FUNCTION_DIRS) expect(readdirSync(d), rel(d)).toEqual(["index.ts"]);
    expect(SERVER_FILES.length).toBeGreaterThanOrEqual(20);
    expect(SHARED_SIBLINGS.sort()).toEqual(
      readdirSync(SHARED_DIR)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => f.replace(/\.ts$/, ""))
        .sort(),
    );
  });

  it.each(SERVER_FILES.map((f) => [rel(f), f] as const))(
    "%s imports only a NAMED health sibling or the Supabase client",
    (_r, f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(IMPORT_SPEC)) {
        expect(importAllowed(f, specOf(m)), `${rel(f)} imports ${specOf(m)}`).toBe(true);
      }
    },
  );

  it.each(FUNCTION_DIRS.map((d) => [rel(d), join(d, "index.ts")] as const))(
    "%s reaches, transitively, nothing outside _shared/health",
    (_r, entry) => {
      const modules = reachable(entry);
      expect(modules.length).toBeGreaterThanOrEqual(8);
      for (const m of modules) {
        expect(m.startsWith(SHARED_DIR + "/"), `${rel(entry)} reaches ${rel(m)}`).toBe(true);
      }
    },
  );

  it.each(SERVER_FILES.map((f) => [rel(f), f] as const))(
    "%s opens no network path — strings included",
    (_r, f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      const hit = EGRESS.exec(src);
      expect(hit, `${rel(f)} carries ${hit?.[0]}`).toBeNull();
      // And the executable text too, so a masked string cannot be the one place it lives.
      expect(executableText(readFileSync(f, "utf8")), rel(f)).not.toMatch(EGRESS);
    },
  );

  it.each(SERVER_FILES.map((f) => [rel(f), f] as const))(
    "%s calls rpc only from the closed list",
    (_r, f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\.rpc\(\s*["']([^"']+)["']/g)) {
        expect(SERVER_RPC_ALLOWED, `${rel(f)} calls rpc ${m[1]}`).toContain(m[1]);
      }
      expect(src).not.toMatch(/\.rpc\(\s*[^"'\s)]/);
    },
  );

  it("the health functions import nothing from __tests__ and nothing named inline", () => {
    for (const f of SERVER_FILES) {
      const src = stripComments(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/__tests__|InlineTextSource|Misbehaving/);
    }
  });
});

describe("egress allowlist — client", () => {
  it("finds the health screens, so this cannot pass vacuously", () => {
    expect(CLIENT_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CLIENT_FILES.map((f) => [rel(f), f] as const))(
    "%s invokes only health-api or health-ai, and fetches nothing",
    (_r, f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/invoke\(\s*([^,)]+)/g)) {
        expect(['"health-api"', '"health-ai"'], `${rel(f)} invokes ${m[1]}`).toContain(m[1].trim());
      }
      expect(src, rel(f)).not.toMatch(
        /\bfetch\b|sendBeacon|\bWebSocket\b|\bEventSource\b|\bXMLHttpRequest\b|\bimport\s*\(/,
      );
      expect(src, rel(f)).not.toMatch(
        /firebase|@google\/generative-ai|dangerouslySetInnerHTML|useServerFn/,
      );
    },
  );

  it("the AI client sends the CLOSED body and never a text field", () => {
    const src = stripComments(readFileSync(join(ROOT, "src/health/ai/client.ts"), "utf8"));
    expect(src).toContain('invoke("health-ai"');
    expect(src).toMatch(/body\.recordId|body\.documentId|body\.question|body\.language/);
    expect(src).not.toMatch(/body\.text\b|excerpt/);
  });
});

describe("what a provider is handed", () => {
  it("carries aliases, counts and scrubbed text — no id, no user, no path, no consent", async () => {
    const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const store = new FakeStore(
      new Map([
        [
          u(1),
          {
            id: u(1),
            consents: [
              {
                id: "s",
                purpose: "store_records",
                dataCategories: ["labs"],
                recipient: "oniq",
                status: "active",
                startTime: "2026-01-01T00:00:00.000Z",
                expiryTime: null,
                termsVersion: "health-terms-v1",
              },
              {
                id: "a",
                purpose: "ai_interpretation",
                dataCategories: ["labs"],
                recipient: "oniq",
                status: "active",
                startTime: "2026-01-01T00:00:00.000Z",
                expiryTime: null,
                termsVersion: "health-ai-terms-v1",
              },
            ],
            records: [
              {
                id: u(5),
                kind: "lab",
                display: "HbA1c",
                value_num: 6.1,
                value_unit: "%",
                value_text: "rao@example.com",
                effective_at: "2026-03-14T00:00:00.000Z",
                status: "active",
                provenance: { source: "user_entry" },
              },
            ],
            documents: [],
          },
        ],
      ]),
      u(1),
    );
    const seen: string[] = [];
    const flags = allHealthFlagsOff();
    flags["health.enabled"] = true;
    flags["health.ai.enabled"] = true;
    const r = await runHealthAi(
      {
        store,
        now: "2026-09-08T12:00:00.000Z",
        requestId: u(9),
        textSource: null,
        providerFor: (id) => {
          const real = providerFor(id);
          return { ...real, run: (input) => (seen.push(JSON.stringify(input)), real.run(input)) };
        },
      },
      {
        flags,
        environment: "staging",
        provider: "synthetic",
        model: "synthetic-v1",
        capPerUser: 5,
        capHouse: 5,
        adminVerificationEnabled: false,
      },
      { isAdmin: false, isAdult: true, regionBlocked: false },
      { task: "explain_record", recordId: u(5) },
    );
    expect(r.ok).toBe(true);
    const input = seen[0];
    expect(input).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    expect(input).not.toMatch(/userId|user_id|storage_path|consent|requestId|example\.com/);
    expect(JSON.parse(input)).toMatchObject({
      task: "explain_record",
      model: "synthetic-v1",
      counts: { records: 1, documents: 0 },
    });
  });
});

describe("the promise stands", () => {
  it("the privacy notice still says health data never reaches an AI feature, and no recipient leaves ONIQ", () => {
    const privacy = readFileSync(join(ROOT, "src/routes/privacy.tsx"), "utf8").toLowerCase();
    expect(privacy).toMatch(/health data is never sent to any ai/);
    // The two facts are tied: this assertion is what must change, with the
    // notice, the day a provider that leaves ONIQ is registered (05 §13).
    expect(Object.values(RECIPIENT_FOR_PROVIDER).every((r) => r === "oniq")).toBe(true);
  });

  it("no edge function outside the two health functions names a health table, and none imports from _shared/health", () => {
    const fns = readdirSync(join(ROOT, "supabase/functions"), { withFileTypes: true })
      .filter(
        (d) =>
          d.isDirectory() &&
          !d.name.startsWith("_") &&
          !["health-api", "health-ai"].includes(d.name),
      )
      .map((d) => join(ROOT, "supabase/functions", d.name));
    expect(fns.length).toBeGreaterThan(40);
    for (const dir of fns) {
      for (const f of walk(dir)) {
        const src = stripComments(readFileSync(f, "utf8"));
        expect(src, rel(f)).not.toMatch(
          /\bhealth_(records|documents|consents|audit|config|retention_policies|ai_requests)\b|health-documents|"health-ai"|_shared\/health\//,
        );
      }
    }
  });
});

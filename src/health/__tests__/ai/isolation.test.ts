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
 * template literal in synthetic.ts; a new ai/ file importing
 * ../../fetchTimeout.ts; a new health-ai/net.ts; a bracket-accessed
 * functions["invoke"], an aliased globalThis.fetch and a Worker in
 * health-ai/index.ts) walked past the first version of this file with every
 * guard green. Each is a red test now.
 *
 * PHASE 3 (owner directive 2026-09-09) ADDED THE ONE LEGITIMATE EXIT and
 * narrowed the guard around it rather than loosening it: `ai/vertex.ts` may
 * import exactly two named modules outside the tree and may contain exactly
 * one `fetch`, to exactly one host; every other file is held to the old
 * rule unchanged, and scripts/health-mutate-guards.sh M9–M11 prove a second
 * host, a third module and a rewritten host constant each go red.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executableText, stripComments } from "@/test/sourceText";
import { HEALTH_AI_PRIVACY_STATEMENT, HEALTH_AI_RECIPIENT_NAME } from "@/config/privacy";
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
  // THIS LIST MIRRORS THE DIRECTORY, and the test below asserts that exactly
  // — so a new shared module is a deliberate edit here rather than a silent
  // widening. It is not a curated subset: dropping these two to "keep the
  // allowlist tight" was tried on 2026-09-10 and fails that assertion.
  //
  // Being reachable is not the same as being reached. Nothing under ai/
  // imports either of these, and `scanPreview.test.ts` asserts that
  // separately: a DICOM never enters the AI pipeline, which is the whole of
  // owner directive 2026-09-10's B half.
  "dicom",
  "dicomRender",
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

/**
 * THE ONE FILE THAT MAY LEAVE THE TREE, and the two modules it may reach
 * (Phase 3, owner directive 2026-09-09): the Google credential ONIQ already
 * mints for every other Vertex call, and the reader of Google's error shapes.
 * Named by full path, not by a `../../` wildcard — M10 in
 * scripts/health-mutate-guards.sh proves a third module goes red.
 */
const VERTEX_FILE = "supabase/functions/_shared/health/ai/vertex.ts";
const VERTEX_OUTSIDE = ["../../googleAuth.ts", "../../vertexError.ts"];
/**
 * THE ONE THIRD-PARTY MODULE (Phase 3b, owner directive 2026-09-09 "A, B and
 * C"): the PDF reader, pinned to an exact version, importable from exactly
 * one file. It is handed bytes and opens no socket; M12/M13 in
 * scripts/health-mutate-guards.sh prove a second importer and a second
 * package both go red.
 */
const PDF_FILE = "supabase/functions/_shared/health/ai/pdfText.ts";
const PDF_MODULE = "npm:unpdf@1.8.1";

/** Which specifiers a file at this path may import; everything else is an escape. */
function importAllowed(file: string, spec: string): boolean {
  if (spec === SUPABASE_JS) return true;
  const r = rel(file);
  if (r === PDF_FILE && spec === PDF_MODULE) return true;
  if (!spec.startsWith("./") && !spec.startsWith("../")) return false;
  if (r === VERTEX_FILE && VERTEX_OUTSIDE.includes(spec)) return true;
  if (spec.includes("../../")) return false;
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
  // Phase 4: the caps and the receipt in one locked transaction (migration
  // 20260909150000); service role only, and reserve.test.ts reads its body.
  "health_ai_reserve_request",
];

describe("the registry", () => {
  it("names exactly two providers — synthetic to ONIQ, vertex to Google Vertex (Phase 3)", () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual(["synthetic", "vertex"]);
    expect([...PROVIDER_IDS]).toEqual(["synthetic", "vertex"]);
    expect(RECIPIENT_FOR_PROVIDER).toEqual({ synthetic: "oniq", vertex: "google_vertex" });
    for (const r of AI_RECIPIENTS) expect(RECIPIENTS).toContain(r);
    const vertex = providerFor("vertex");
    expect(vertex.id).toBe("vertex");
    expect(vertex.recipient).toBe("google_vertex");
    expect(vertex.synthetic).toBe(false);
    expect(providerFor("synthetic").synthetic).toBe(true);
  });

  it.each([
    "gemini",
    "medgemma",
    "google_vertex",
    "google",
    "openai",
    "anthropic",
    "",
    null,
    undefined,
    1,
    "SYNTHETIC",
    "VERTEX",
    "Vertex",
    "vertex ",
    ["vertex"],
  ])("refuses %s", (id) => {
    expect(() => providerFor(id)).toThrow(/provider_not_allowed/);
  });

  it("the factories take no arguments and neither provider class has constructor options", () => {
    const src = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai/provider.ts"), "utf8"),
    );
    expect(src).toContain("synthetic: () => new SyntheticHealthAIProvider(),");
    expect(src).toContain("vertex: () => new VertexHealthAIProvider(),");
    expect(PROVIDER_REGISTRY.synthetic.length).toBe(0);
    expect(PROVIDER_REGISTRY.vertex.length).toBe(0);
    for (const [file, className] of [
      ["synthetic.ts", "SyntheticHealthAIProvider"],
      ["vertex.ts", "VertexHealthAIProvider"],
    ]) {
      const whole = stripComments(
        readFileSync(join(ROOT, "supabase/functions/_shared/health/ai", file), "utf8"),
      );
      expect(whole, file).not.toMatch(/misbehav/i);
      // The PROVIDER class body: from its declaration to the end of the file
      // (it is the last thing in each). vertex.ts also declares ProviderError,
      // whose constructor takes a code and a message — that is not a mode.
      const start = whole.indexOf(`export class ${className}`);
      expect(start, `${file} declares ${className}`).toBeGreaterThan(-1);
      const cls = whole.slice(start);
      expect(cls, file).not.toMatch(/constructor\(/);
      expect(cls, file).not.toMatch(new RegExp(`export class (?!${className})`));
    }
    // The transport and the credential are PROTECTED methods a test-only
    // subclass overrides — never module state a caller could reach.
    const vertex = stripComments(
      readFileSync(join(ROOT, "supabase/functions/_shared/health/ai/vertex.ts"), "utf8"),
    );
    expect(vertex).toMatch(/protected token\(\)/);
    expect(vertex).toMatch(/protected async send\(/);
    // No MODULE-level mutable state (a `let` at column 0): nothing a request
    // could flip. Locals inside functions are fine.
    expect(vertex).not.toMatch(/^(export )?let /m);
    expect(vertex).not.toMatch(/Deno\.env\.get\(\s*["'](?!GOOGLE|FIREBASE)/);
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

  it("registers one zero-arity text source (null); the stored-document source is built by name with its deps, and any other id is null", async () => {
    expect(Object.keys(TEXT_SOURCE_REGISTRY)).toEqual(["null"]);
    expect([...TEXT_SOURCE_IDS]).toEqual(["null", "document"]);
    expect(textSourceFor("inline")).toBeInstanceOf(NullTextSource);
    expect(textSourceFor("document")).toBeInstanceOf(NullTextSource);
    expect(await textSourceFor("null").read("any")).toBeNull();
  });

  it("the PDF reader is the only file naming the one third-party module, pinned to an exact version, and it opens no socket", () => {
    const importers = SERVER_FILES.filter((f) =>
      stripComments(readFileSync(f, "utf8")).includes("npm:unpdf"),
    );
    expect(importers.map(rel)).toEqual([PDF_FILE]);
    const src = stripComments(readFileSync(join(ROOT, PDF_FILE), "utf8"));
    expect(src).toContain(`from "${PDF_MODULE}"`);
    expect(src.match(/npm:/g)?.length ?? 0).toBe(1);
    expect(src).not.toMatch(EGRESS);
    expect(src).toContain("isEvalSupported: false");
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
    "%s reaches, transitively, nothing outside _shared/health but the vertex provider's two named modules",
    (_r, entry) => {
      const modules = reachable(entry);
      expect(modules.length).toBeGreaterThanOrEqual(8);
      const allowedOutside = VERTEX_OUTSIDE.map((s) => resolve(join(ROOT, VERTEX_FILE), "..", s));
      const outside = modules.filter((m) => !m.startsWith(SHARED_DIR + "/"));
      expect(outside.map(rel).sort(), `${rel(entry)} reaches outside the tree`).toEqual(
        allowedOutside.map(rel).sort(),
      );
      // And those two reach nothing further: the boundary is two files deep, not open-ended.
      for (const m of allowedOutside) {
        expect(existsSync(m), rel(m)).toBe(true);
        expect(reachable(m), `${rel(m)} imports something`).toEqual([]);
      }
    },
  );

  /** The vertex provider is allowed the word `fetch` and nothing else on the egress list. */
  const EGRESS_BUT_FETCH = new RegExp(EGRESS.source.replace("\\bfetch\\b|", ""));

  it.each(SERVER_FILES.filter((f) => rel(f) !== VERTEX_FILE).map((f) => [rel(f), f] as const))(
    "%s opens no network path — strings included",
    (_r, f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      const hit = EGRESS.exec(src);
      expect(hit, `${rel(f)} carries ${hit?.[0]}`).toBeNull();
      // And the executable text too, so a masked string cannot be the one place it lives.
      expect(executableText(readFileSync(f, "utf8")), rel(f)).not.toMatch(EGRESS);
    },
  );

  it("the vertex provider opens exactly one network path: one fetch, to the one host, and no other egress word", () => {
    const f = join(ROOT, VERTEX_FILE);
    expect(SERVER_FILES).toContain(f);
    expect(EGRESS_BUT_FETCH.source).not.toContain("fetch");
    const src = stripComments(readFileSync(f, "utf8"));
    const hit = EGRESS_BUT_FETCH.exec(src);
    expect(hit, `vertex.ts carries ${hit?.[0]}`).toBeNull();
    expect(executableText(readFileSync(f, "utf8"))).not.toMatch(EGRESS_BUT_FETCH);
    expect(src.match(/\bfetch\b/g)?.length ?? 0).toBe(1);
    expect(src.match(/\bfetch\(/g)?.length ?? 0).toBe(1);
    // One host, as a named constant the URL builder interpolates — M11 in
    // scripts/health-mutate-guards.sh proves a rewritten constant goes red.
    expect(src).toContain('export const VERTEX_HOST = "aiplatform.googleapis.com";');
    expect(src.match(/googleapis\.com/g)?.length ?? 0).toBe(1);
    expect(src.match(/https?:\/\//g)?.length ?? 0).toBe(1);
    expect(src).toMatch(/`https:\/\/\$\{VERTEX_HOST\}\//);
    // The credential is minted by the shared module, never read here by name.
    expect(src).not.toMatch(
      /private_key|client_email|FIREBASE_SERVICE_ACCOUNT|GOOGLE_SERVICE_ACCOUNT_JSON/,
    );
    expect(src).toMatch(/googleAccessToken\(\)/);
  });

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

describe("the disclosure stands", () => {
  it("the privacy notice carries the owner's statement, the absolute claim is gone, and the ONE recipient that leaves ONIQ is named", () => {
    // Owner directive 2026-09-09 replaced "never sent to any AI feature"; the
    // Phase 3 directive the same day registered a provider that leaves ONIQ,
    // and 05 §13 said the notice must then NAME it. It does, by the constant
    // the registry's recipient is tied to (privacyDisclosure.test.ts).
    const privacy = readFileSync(join(ROOT, "src/routes/privacy.tsx"), "utf8")
      .replace(/\{"\s*"\}/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
    expect(privacy).toContain(HEALTH_AI_PRIVACY_STATEMENT);
    expect(privacy).toContain(HEALTH_AI_RECIPIENT_NAME);
    expect(privacy.toLowerCase()).not.toMatch(/never sent to any ai/);
    const outside = Object.entries(RECIPIENT_FOR_PROVIDER).filter(([, r]) => r !== "oniq");
    expect(outside).toEqual([["vertex", "google_vertex"]]);
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

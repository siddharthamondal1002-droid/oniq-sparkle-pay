/**
 * HEALTH → AI DIRECT PATH = IMPOSSIBLE, as a red test.
 *
 * The registry names one provider that never leaves the process, and the
 * only way out of the health domain is an ALLOWLIST: the health functions
 * and the shared tree may import ./-relative siblings and the Supabase
 * client and nothing else; their executable text has no fetch, no
 * functions.invoke, no dynamic import, no socket, no subprocess, and no rpc
 * outside a closed list. On the client, the health screens may invoke only
 * "health-api" and "health-ai". A provider is handed aliases and never an
 * id. The privacy promise stands, and the day a recipient other than ONIQ
 * appears in RECIPIENT_FOR_PROVIDER while it still stands, this fails.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
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

const SERVER_FILES = [
  ...walk(join(ROOT, "supabase/functions/_shared/health")),
  join(ROOT, "supabase/functions/health-api/index.ts"),
  join(ROOT, "supabase/functions/health-ai/index.ts"),
];
const CLIENT_FILES = [
  ...walk(join(ROOT, "src/health")),
  ...readdirSync(join(ROOT, "src/routes/_authenticated"))
    .filter((f) => /^app\.health.*\.tsx$|^app\.admin_\.health-ai\.tsx$/.test(f))
    .map((f) => join(ROOT, "src/routes/_authenticated", f)),
];

const SUPABASE_JS = "https://esm.sh/@supabase/supabase-js@2";
const EGRESS =
  /\bfetch\s*\(|functions\.invoke|\bimport\s*\(|WebSocket|EventSource|XMLHttpRequest|sendBeacon|Deno\.connect|Deno\.Command|Deno\.run|Deno\.listen/;
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

  it("registers no text source: null yields nothing, and any other id is null too", async () => {
    expect(Object.keys(TEXT_SOURCE_REGISTRY)).toEqual(["null"]);
    expect([...TEXT_SOURCE_IDS]).toEqual(["null"]);
    expect(textSourceFor("inline")).toBeInstanceOf(NullTextSource);
    expect(await textSourceFor("null").text("any")).toBeNull();
  });
});

describe("egress allowlist — server", () => {
  it.each(SERVER_FILES.map((f) => [rel(f), f] as const))(
    "%s imports only health siblings and the Supabase client",
    (_r, f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = m[1];
        const ok =
          spec === SUPABASE_JS ||
          spec.startsWith("./") ||
          /^\.\.\/_shared\/health\//.test(spec) ||
          (rel(f).startsWith("supabase/functions/_shared/health/ai/") && spec.startsWith("../"));
        expect(ok, `${rel(f)} imports ${spec}`).toBe(true);
        expect(spec, `${rel(f)} reaches outside the health tree`).not.toMatch(
          /llm|googleAuth|googleDirect|geminiFailover|vertexError|firebase|capability/,
        );
      }
    },
  );

  it.each(SERVER_FILES.map((f) => [rel(f), f] as const))("%s opens no network path", (_r, f) => {
    const code = executableText(readFileSync(f, "utf8"));
    expect(code, rel(f)).not.toMatch(EGRESS);
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
      expect(src, rel(f)).not.toMatch(/\bfetch\s*\(/);
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

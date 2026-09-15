/**
 * REPOSITORY-WIDE SPEND COVERAGE — the audit, kept honest by a test.
 *
 * The wiring loop asked two questions of the whole codebase: where does ONIQ
 * search, and where does ONIQ call AI. This file is the answer in a form that
 * cannot go stale, because it FAILS when a new billable caller appears without
 * a reservation and it FAILS when a guarded caller loses its guard.
 *
 * The unguarded list below is a FROZEN TAIL, exactly like eslint-suppressions:
 * it records what was already there on 2026-08-24, with the reason each entry
 * is out of scope for this pass. Adding to it to silence a NEW caller defeats
 * the point — the correct move for a new caller is to guard it.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const FN_DIR = join(ROOT, "supabase/functions");
const read = (p: string) => readFileSync(p, "utf8");

/** Anything that reaches a metered model provider from an edge function. */
const PROVIDER_CALL =
  /api\.anthropic\.com|generativelanguage\.googleapis\.com|ai\.gateway\.lovable\.dev|api\.runwayml\.com|api\.openai\.com|callClaude\(|callGemini\(/;

const SEARCH_TOOL = /web_search_\d{8}/;

/** Comments describe code; they are not code. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function edgeFunctions(): Array<{ name: string; path: string; src: string }> {
  return readdirSync(FN_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => ({ name: d.name, path: join(FN_DIR, d.name, "index.ts") }))
    .filter((f) => {
      try {
        readFileSync(f.path);
        return true;
      } catch {
        return false;
      }
    })
    .map((f) => ({ ...f, src: read(f.path) }));
}

/**
 * Billable callers that do NOT hold a spend reservation, as of 2026-08-24.
 *
 * NONE of these uses the web_search tool — verified by the search-coverage test
 * below — so none of them pays the $10/1,000 search fee that made the scouts
 * expensive. They are plain token spend, which is a smaller and much more
 * predictable class. That is the reason they were not wired in this pass, not
 * an argument that they never should be.
 */
const UNGUARDED_AI_CALLERS: Record<string, string> = {
  "cv-generate": "LLM only, no web_search; bounded single generation",
  "ride-genie": "LLM only, no web_search",
  "story-plot": "LLM only; already inside the story job's claim_story_seconds cost guard",
  "story-clip": "VIDEO, not search; guarded separately by the story seconds claim",
  "study-chapter-notes": "LLM only, no web_search",
  "study-chapters": "LLM only, no web_search",
  "study-paper-generate": "LLM only, no web_search",
  "study-paper-grade": "LLM only, no web_search",
  "study-paper-mock": "LLM only, no web_search",
  "study-quiz": "LLM only, no web_search",
  "study-tutor": "LLM only, no web_search",
  "translate-message": "LLM only, no web_search",
  translate: "LLM only, no web_search; Lovable gateway credits, not the metered key",
  "story-still": "IMAGE, not search; Lovable gateway credits, inside the story seconds claim",
  "story-voice": "TTS, not search; Lovable gateway credits, inside the story seconds claim",
};

/**
 * Callers wired to the ledger in this pass. `health-scan` left this list on
 * 2026-09-09: it is a 410 stub now (owner directive — Anthropic off the
 * Health AI path), so it neither searches nor calls a provider;
 * src/health/__tests__/anthropicRetired.test.ts pins the stub.
 */
const GUARDED = ["smart-scout", "hotel-scout", "ting"];
/**
 * Callers that hold a reservation for TOKENS ONLY via the search adapter — no
 * web_search, so they are not part of the search fleet, but they are billable
 * and therefore guarded. watch-ask (owner mission, 2026-09-03) answers from a
 * person's own notes.
 */
const GUARDED_TOKEN_ONLY = ["watch-ask"];

/**
 * Callers reserved DIRECTLY against the financial ledger, bypassing the
 * per-token search adapter (`withSearchSpendGuard`) entirely — because doing
 * it the other way is a production incident that already happened.
 * music-generate (owner directive, 2026-09-04) shipped on the search adapter
 * first, which reserves via a MODEL_RATES lookup. Lyria is not priced per
 * token — it is deliberately absent from that table, same reason as the
 * settlement note below — so the lookup always threw, admission always
 * refused "unpriced-model", and every request died before Google was ever
 * called, for every user, until 2026-09-04. image-generate and voice-generate
 * had the identical bug, caught before either shipped live (both still ship
 * with their kill switch off).
 *
 * Each now reserves a flat, owner-given per-generation figure — $0.08/song,
 * ~$0.067/image, ~$0.16/voice-clip — directly against its own
 * provider_budget_config capability (MUSIC / IMAGE / TTS), and settles the
 * same way the search adapter always did: Google/the gateway reports no cost
 * for any of these units, so the ledger charges the reservation and keeps
 * measured tokens (where the response carries any) for provenance only.
 */
/**
 * `frontier-probe` joined 2026-09-12 and is a different SHAPE from the other
 * three, which is why it is worth a line rather than just an entry.
 *
 * The three generators reserve a flat owner-given figure per generation
 * because the provider reports no cost for a song, an image or a clip. The
 * probe reserves a flat figure for the opposite reason: it exists to POST a
 * model id NOBODY HAS PRICED YET — this repo's oldest rule is that only a POST
 * says what a key may call — and a per-token reservation would make the check
 * impossible to perform on exactly the models it is for. Its worst case is
 * knowable from the request (a ~20-token prompt, 16 output tokens, at most 3
 * ids), so a cent is a true ceiling rather than a guess.
 */
const GUARDED_DIRECT_LEDGER = [
  "frontier-probe",
  "music-generate",
  "image-generate",
  "voice-generate",
];

describe("every SEARCH in the repository is reserved for", () => {
  const fns = edgeFunctions();

  it("finds the search fleet at all — a passing test on an empty set proves nothing", () => {
    const searchers = fns
      .filter((f) => SEARCH_TOOL.test(f.src))
      .map((f) => f.name)
      .sort();
    expect(searchers).toEqual([...GUARDED].sort());
  });

  it("every function using web_search holds a reservation", () => {
    for (const f of fns) {
      if (!SEARCH_TOOL.test(f.src)) continue;
      expect(f.src, `${f.name} runs web_search without withSearchSpendGuard`).toMatch(
        /withSearchSpendGuard\(/,
      );
    }
  });

  it("every web_search declaration carries an explicit max_uses", () => {
    // Ting's had none: one chat turn could run unbounded billed searches, which
    // is a spend nobody can reserve for. Comments are stripped first — a
    // comment quoting the old, unbounded declaration is documentation.
    for (const f of fns) {
      const code = stripComments(f.src);
      for (const decl of code.matchAll(/\{[^{}]*web_search_\d{8}[^{}]*\}/g)) {
        expect(decl[0], `${f.name} declares web_search with no max_uses`).toMatch(/max_uses:/);
      }
    }
  });

  it("no search function keeps the tool-less Gemini fallback", () => {
    // translateToolsToGemini SKIPS Anthropic server tools, so a fallback answer
    // to a "find live prices" prompt is written from memory with fabricated
    // `verified` source domains.
    for (const name of ["smart-scout", "hotel-scout"]) {
      const src = read(join(FN_DIR, name, "index.ts"));
      expect(src, `${name} must forbid the tool-less fallback`).toMatch(/allowFallback:\s*false/);
    }
  });
});

describe("every AI CALL in the repository is either reserved for or listed", () => {
  const fns = edgeFunctions();

  it("no billable caller is unaccounted for", () => {
    const unexplained: string[] = [];
    for (const f of fns) {
      if (!PROVIDER_CALL.test(f.src)) continue;
      const guarded =
        /withSearchSpendGuard\(/.test(f.src) || /withProviderSpendGuard\(/.test(f.src);
      if (guarded) continue;
      if (!(f.name in UNGUARDED_AI_CALLERS)) unexplained.push(f.name);
    }
    expect(
      unexplained,
      "a NEW billable caller appeared without a spend reservation — guard it, do not list it",
    ).toEqual([]);
  });

  it("the frozen tail has not silently grown", () => {
    expect(Object.keys(UNGUARDED_AI_CALLERS).length).toBe(15);
  });

  it("nothing on the frozen tail uses the metered web_search fee", () => {
    for (const name of Object.keys(UNGUARDED_AI_CALLERS)) {
      const src = read(join(FN_DIR, name, "index.ts"));
      expect(src, `${name} is on the unguarded list but runs web_search`).not.toMatch(SEARCH_TOOL);
    }
  });

  it("the guarded set is exactly what it claims to be", () => {
    const guarded = fns.filter((f) => /withSearchSpendGuard\(/.test(f.src)).map((f) => f.name);
    expect(guarded.sort()).toEqual([...GUARDED, ...GUARDED_TOKEN_ONLY].sort());
  });
  it("a token-only guarded caller reserves for zero searches and declares none", () => {
    for (const name of GUARDED_TOKEN_ONLY) {
      const src = read(join(FN_DIR, name, "index.ts"));
      expect(src, `${name} runs web_search but is listed as token-only`).not.toMatch(SEARCH_TOOL);
      expect(src, `${name} must reserve for zero searches`).toMatch(/maxSearches:\s*0/);
    }
  });

  it("the direct-ledger set is exactly what it claims to be", () => {
    const direct = fns.filter((f) => /withProviderSpendGuard\(/.test(f.src)).map((f) => f.name);
    expect(direct.sort()).toEqual([...GUARDED_DIRECT_LEDGER, ...GUARDED_HYBRID].sort());
  });
  it("a direct-ledger caller never uses the metered web_search tool", () => {
    // The whole point of bypassing the search adapter is that these units
    // aren't search — a caller that both bypasses it AND runs web_search
    // would spend the $10/1,000 search fee with nothing reserving for it.
    for (const name of GUARDED_DIRECT_LEDGER) {
      const src = read(join(FN_DIR, name, "index.ts"));
      expect(src, `${name} runs web_search but is listed as direct-ledger`).not.toMatch(
        SEARCH_TOOL,
      );
    }
  });
  it("a hybrid caller holds BOTH guards, one per provider leg", () => {
    // ting is the only caller with a mixed ladder: its OpenAI leg reserves a
    // bounded figure directly (no published per-token rate exists for that
    // provider — see _shared/tingProviders.ts), while its Gemini and Anthropic
    // legs stay on the per-token search adapter that has always priced them.
    // The exemption above must NOT extend to it: the leg that runs web_search
    // is the adapter-guarded one, which is exactly what this pins.
    for (const name of GUARDED_HYBRID) {
      const src = read(join(FN_DIR, name, "index.ts"));
      expect(src, `${name} must keep the search adapter for its metered legs`).toMatch(
        /withSearchSpendGuard\(/,
      );
      expect(src, `${name} must reserve its unpriced leg directly`).toMatch(
        /withProviderSpendGuard\(/,
      );
    }
  });

});

describe("no direct provider invocation from UI code", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name === "node_modules" || d.name === "__tests__") continue;
        walk(p, out);
      } else if (/\.(ts|tsx)$/.test(d.name)) out.push(p);
    }
    return out;
  }

  it("src/ never talks to a model provider itself", () => {
    const offenders: string[] = [];
    for (const p of walk(join(ROOT, "src"))) {
      const src = read(p);
      if (/api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.runwayml\.com/.test(src)) {
        // A comment naming an endpoint is documentation, not a call.
        const lines = src
          .split("\n")
          .filter((l) => /https:\/\/(api\.anthropic|generativelanguage|api\.runwayml)/.test(l));
        if (lines.some((l) => /fetch\s*\(|axios|XMLHttpRequest/.test(l))) {
          offenders.push(p.slice(ROOT.length + 1));
        }
      }
    }
    expect(offenders, "UI code must reach providers only through an edge function").toEqual([]);
  });

  /**
   * Naming a secret is not leaking one. `app.ai.tsx` renders the literal string
   * "ANTHROPIC_API_KEY" to tell the owner which secret to set, and that is
   * correct. What must never happen is a browser-bundled file READING one.
   *
   * Server-only files are the exception by construction: `*.server.ts` and the
   * route handlers under src/routes/api and src/routes/lovable run on the
   * server and never reach a client bundle.
   */
  const SERVER_ONLY = /\.server\.tsx?$|src[\\/]routes[\\/](api|lovable)[\\/]/;
  const SECRET_READ =
    /process\.env(?:\.|\[["'])(?:ANTHROPIC_API_KEY|GOOGLE_AI_API_KEY|RUNWAY_API_KEY|SUPABASE_SERVICE_ROLE_KEY)/;

  it("no browser-bundled file reads a provider or service-role secret", () => {
    const offenders: string[] = [];
    for (const p of walk(join(ROOT, "src"))) {
      const rel = p.slice(ROOT.length + 1);
      if (SERVER_ONLY.test(rel)) continue;
      if (SECRET_READ.test(read(p))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the secret-read check actually matches something — it is not a dead regex", () => {
    const serverReaders = walk(join(ROOT, "src"))
      .map((p) => p.slice(ROOT.length + 1))
      .filter((rel) => SERVER_ONLY.test(rel) && SECRET_READ.test(read(join(ROOT, rel))));
    expect(serverReaders.length).toBeGreaterThan(0);
  });
});

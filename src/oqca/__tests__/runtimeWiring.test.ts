/**
 * THE WIRING, READ FROM SOURCE — brief sections 2, 3, 4, 5 and 7.
 *
 * These are the properties a typecheck cannot see and a behavioural test cannot
 * reach: which file names the provider, which function calls the loop, and
 * which direction the imports run. Every one of them is the kind of thing that
 * breaks silently and only in production.
 *
 * COMMENTS ARE STRIPPED FIRST, ALWAYS. Every file below explains in prose the
 * thing it is being checked for — `engine.ts`'s header says why it does NOT
 * import `callText`, `toolRouter.ts`'s says ONIQ has no ToolRouter. A grep
 * strict enough to be useful hits those sentences, and this repo has now made
 * that mistake eleven times.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/sourceText";

const RUNTIME = "supabase/functions/_shared/oqcaRuntime";
const KERNEL = "supabase/functions/_shared/oqca";
const FUNCTIONS = "supabase/functions";
const CALLER = "supabase/functions/story-dispatch/index.ts";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const code = (f: string) => stripComments(readFileSync(f, "utf8"));

describe("section 4 — the model boundary is the existing callText, once", () => {
  it("exactly one file names callText, and it is provider.ts", () => {
    const named = walk(RUNTIME).filter((f) => /\bcallText\b/.test(code(f)));
    expect(named).toEqual([`${RUNTIME}/provider.ts`]);
  });

  it("and it imports it from _shared/llm.ts — no new provider, no new key", () => {
    const src = code(`${RUNTIME}/provider.ts`);
    expect(src).toMatch(/import \{ callText \} from "\.\.\/llm\.ts";/);
    // A second provider would arrive as a second import, an API key, or a URL.
    expect(src).not.toMatch(/api[_-]?key/i);
    expect(src).not.toMatch(/https?:\/\//);
  });

  it("the engine adapter names no provider at all, so it stays testable", () => {
    const src = code(`${RUNTIME}/engine.ts`);
    expect(src).not.toMatch(/\bcallText\b/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    // The provider is a REQUIRED field: an optional one would default to
    // something, and the default would be the second way in.
    expect(src).toMatch(/readonly call: \(opts: ProviderRequest\)/);
  });

  it("the model id is the registry's, not a literal typed here", () => {
    const src = code(`${RUNTIME}/engine.ts`);
    expect(src).toMatch(/TEXT_DIRECT_STANDARD\.id/);
    expect(src).not.toMatch(/["']gemini-[\d.]+/);
  });
});

describe("section 5 — the router adapts the existing authorization boundary", () => {
  it("ONIQ still has no other ToolRouter, which is why this one is an adapter", () => {
    // THE MEASUREMENT THAT SHAPED THE DESIGN, kept as an assertion so the day
    // a real one appears this goes red and the adapter is reconsidered rather
    // than quietly becoming a second authorization system.
    const others = walk(FUNCTIONS)
      .filter((f) => !f.startsWith(RUNTIME) && !f.startsWith(KERNEL))
      .filter((f) => /\bToolRouter\b|\btoolRegistry\b|\bdispatchTool\b/.test(code(f)));
    expect(others).toEqual([]);
  });

  it("the registry is closed: an unknown tool is refused, never defaulted", () => {
    const src = code(`${RUNTIME}/toolRouter.ts`);
    expect(src).toMatch(/if \(!spec\) return null;/);
    expect(src).toMatch(/unknown tool/);
    // There is no `autonomous` mode. Section 9 is enforced by the value not
    // existing rather than by a branch nobody takes.
    expect(src).toMatch(/RouterMode = "shadow" \| "assisted"/);
    expect(src).not.toMatch(/"autonomous"/);
  });

  it("authorize runs before perform, on every path", () => {
    // SCOPED TO `execute`, because `throughLedger` above it also calls
    // `perform` — a whole-file index comparison started passing for the wrong
    // reason the moment the ledger path was added, which is the "a count over a
    // whole file is not a guard" lesson in a new place.
    const src = code(`${RUNTIME}/toolRouter.ts`);
    const exec = src.slice(src.indexOf("execute: async (call)"));
    expect(exec.indexOf("spec.authorize(call)")).toBeGreaterThan(0);
    expect(exec.indexOf("spec.authorize(call)")).toBeLessThan(exec.indexOf("spec.perform(call)"));
    expect(exec.indexOf("spec.authorize(call)")).toBeLessThan(exec.indexOf("throughLedger("));
  });

  it("the dispatch tool re-reads the row rather than trusting the snapshot", () => {
    const src = code(`${RUNTIME}/dispatchJob.ts`);
    const auth = src.slice(src.indexOf("authorize: async"), src.indexOf("perform: async"));
    expect(auth).toMatch(/env\.readJob/);
    expect(auth).toMatch(/isDispatchable/);
  });
});

describe("section 2 and 7 — one caller, flagged off, not replacing anything", () => {
  it("exactly one edge function calls the loop", () => {
    // The kernel is excluded because it DEFINES `runCognitiveLoop`; a caller
    // is a file that invokes one, which is what the parenthesis matches.
    const callers = walk(FUNCTIONS)
      .filter((f) => !f.startsWith(RUNTIME) && !f.startsWith(KERNEL))
      .filter((f) => /\b(runOqcaForDispatch|runShadow|runCognitiveLoop)\s*\(/.test(code(f)));
    expect(callers).toEqual([CALLER]);
  });

  it("the caller reads the flag and does nothing when it is off", () => {
    const src = code(CALLER);
    expect(src).toMatch(/parseMode\(Deno\.env\.get\(OQCA_FLAG_ENV\)\)/);
    // Both call sites are guarded by an explicit mode, so "off" reaches
    // neither. A single unguarded call would run the loop on every tick.
    const guards = [...src.matchAll(/if \(oqcaMode === "(assisted|shadow)"\)/g)].map((m) => m[1]);
    expect(guards.sort()).toEqual(["assisted", "shadow"]);
  });

  it("assisted runs BEFORE the production pick and shadow AFTER the dispatch", () => {
    const src = code(CALLER);
    const assisted = src.indexOf('if (oqcaMode === "assisted")');
    const pick = src.indexOf("const jobId = rows[0].id;");
    const shadow = src.indexOf('if (oqcaMode === "shadow")');
    const send = src.indexOf("api.github.com");
    expect(assisted).toBeGreaterThan(-1);
    expect(assisted).toBeLessThan(pick);
    // Shadow cannot change the answer because the answer is already sent.
    expect(shadow).toBeGreaterThan(send);
  });

  it("the production query is untouched: still one row, still the same filter", () => {
    const src = code(CALLER);
    expect(src).toMatch(/status=eq\.queued/);
    expect(src).toMatch(/order=created_at\.asc&limit=1/);
  });

  it("a shadow run cannot mint a job token", () => {
    const src = code(CALLER);
    const shadowBlock = src.slice(src.indexOf('if (oqcaMode === "shadow")'));
    const payload = shadowBlock.slice(shadowBlock.indexOf("payloadFor"));
    // It THROWS rather than returning an empty payload: reaching it would mean
    // the shadow gate failed, and a silent empty dispatch is the shape of bug
    // that gets found in a bill.
    expect(payload.slice(0, 200)).toMatch(/throw new Error/);
    expect(payload.slice(0, 200)).not.toMatch(/mintJobToken/);
  });
});

describe("section 19 — every transition is on the chain", () => {
  it("the loop body never calls advance() directly", () => {
    // ONE HELPER, `step`, APPENDS TO THE CHAIN AND RETURNS THE STATE. A direct
    // `advance` would produce a state the chain never saw, and a replay of that
    // chain would then be a replay of a DIFFERENT run — silently, because both
    // still typecheck and both still run.
    const src = code(`${KERNEL}/loop/cognitiveLoop.ts`);
    const body = src.slice(src.indexOf("export async function runCognitiveLoop"));
    const helper = body.indexOf("const step =");
    expect(helper).toBeGreaterThan(0);
    const afterHelper = body.slice(body.indexOf("\n", body.indexOf("chain.push(next)")));
    expect(afterHelper).not.toMatch(/\badvance\s*\(/);
    // ...and the helper really is the one that appends.
    expect(body.slice(helper, helper + 400)).toMatch(/chain\.push\(next\)/);
  });

  it("the chain is returned, so a caller can persist it", () => {
    const src = code(`${KERNEL}/loop/cognitiveLoop.ts`);
    expect(src).toMatch(/readonly chain: readonly LoopState\[\];/);
    expect(src).toMatch(/return \{ state, quantum, log, chain,/);
  });
});

describe("section 14 — the verdict comes from the station, not from beside it", () => {
  it("VERIFY calls the injected verifier and asks no model", () => {
    const src = code(`${KERNEL}/loop/cognitiveLoop.ts`);
    const verify = src.slice(src.indexOf('case "VERIFY":'), src.indexOf('case "UPDATE_STATE":'));
    expect(verify).toMatch(/await verifier\(\{/);
    // The first draft asked the MODEL to label its own claims. `ask` is how a
    // station reaches the model, and this one may not.
    expect(verify).not.toMatch(/\bask\s*\(/);
  });

  it("and the runtime supplies the job's verifier rather than running one after", () => {
    const src = code(`${RUNTIME}/shadow.ts`);
    expect(src).toMatch(/verifier: makeVerifier\(env\)/);
    expect(src).toMatch(/run\.state\.verification \?\? NOT_CHECKED/);
  });
});

describe("section 12 — the episode crosses the memory adapter", () => {
  it("consolidate is called with the episode, and its answer is reported", () => {
    const src = code(`${RUNTIME}/shadow.ts`);
    expect(src).toMatch(/memory\.consolidate\(\[/);
    expect(src).toMatch(/persistedEpisodes/);
    // The gap is a MEASUREMENT, not a note: the adapter returns what it really
    // stored and the comparison row carries it.
    expect(src).toMatch(/persistedEpisodes,/);
  });
});

describe("section 5 — a paying tool cannot bypass the ledger", () => {
  it("the router imports withProviderSpendGuard and routes through it", () => {
    const src = code(`${RUNTIME}/toolRouter.ts`);
    // THIS USED TO BE TRUE ONLY IN A COMMENT. The claim "the router adapts the
    // existing authorization boundary" was prose; nothing called the ledger.
    expect(src).toMatch(
      /import \{[\s\S]*withProviderSpendGuard[\s\S]*\} from "\.\.\/financialLedger\.ts";/,
    );
    expect(src).toMatch(/await withProviderSpendGuard\(/);
  });

  it("and a costed tool with no capability or no rpc is refused before performing", () => {
    const src = code(`${RUNTIME}/toolRouter.ts`);
    const exec = src.slice(src.indexOf("execute: async (call)"));
    const gate = exec.indexOf("if (pays && (!spec.capability || !ctx.rpc))");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(exec.indexOf("spec.perform(call)"));
  });
});

describe("section 3 — the kernel does not know the runtime exists", () => {
  it("no mirrored kernel file imports an adapter", () => {
    for (const f of walk(KERNEL)) {
      expect(code(f), f).not.toMatch(/oqcaRuntime/);
    }
  });

  it("and no source kernel file does either", () => {
    for (const f of walk("src/oqca").filter((p) => !p.includes("__tests__"))) {
      expect(code(f), f).not.toMatch(/oqcaRuntime|supabase\/functions/);
    }
  });

  it("the runtime imports the kernel through the MIRROR, never through src/", () => {
    for (const f of walk(RUNTIME)) {
      expect(code(f), f).not.toMatch(/from "[^"]*src\/oqca/);
    }
  });
});

describe("section 22 — nothing in the runtime can modify ONIQ", () => {
  it("no adapter deploys, publishes, writes a file or shells out", () => {
    const banned: readonly [string, RegExp][] = [
      ["a filesystem write", /writeFileSync|createWriteStream|Deno\s*\.\s*writeText/],
      ["a shell", /child_process|\bexecSync\b|\bspawn\s*\(/],
      ["eval", /\beval\s*\(|new\s+Function\s*\(/],
      ["a deploy", /deploy_project|deploy_edge_function|repository_dispatch\s*=/],
      ["a migration", /apply_migration|create\s+table|alter\s+table/i],
    ];
    for (const f of walk(RUNTIME)) {
      const src = code(f);
      for (const [what, pattern] of banned) {
        expect(src, `${f} must not contain ${what}`).not.toMatch(pattern);
      }
    }
  });

  it("only two files reach the network at all, and they are named", () => {
    const reaching = walk(RUNTIME).filter((f) => /\bfetch\s*\(/.test(code(f)));
    expect(reaching).toEqual([`${RUNTIME}/dispatchEnv.ts`]);
    const providers = walk(RUNTIME).filter((f) => /from "\.\.\/llm\.ts"/.test(code(f)));
    expect(providers).toEqual([`${RUNTIME}/provider.ts`]);
  });

  it("the only host the runtime names is GitHub's dispatch API", () => {
    const urls = new Set<string>();
    for (const f of walk(RUNTIME)) {
      for (const m of code(f).matchAll(/https?:\/\/[a-z0-9.-]+/g)) urls.add(m[0]);
    }
    expect([...urls]).toEqual(["https://api.github.com"]);
  });
});

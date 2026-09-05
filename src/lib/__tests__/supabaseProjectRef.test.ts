/**
 * THERE ARE TWO SUPABASE PROJECTS AND ONLY ONE OF THEM IS ONIQ.
 *
 * MEASURED 2026-09-05. `.mcp.json` wires the Supabase MCP server to project
 * `nzbthoecadcwdoqxhaok`, whose name in `list_projects` is "oniq-sparkle-pay" —
 * the same string as this repository. It is NOT the project this app talks to.
 * Production is `bqwttemnnoexadpwifcj`, named in `supabase/config.toml`, in
 * `.env`, and in the Lovable MCP manifest's OAuth issuer.
 *
 * The confusion is not theoretical and it is not cosmetic. Asked for the
 * deployed edge functions, that MCP answered with NINE — story-*,
 * check-user-exists, razorpay-webhook. Probing production directly, one POST
 * per function, answered for all 63 in this repo:
 *
 *   401 firebase-provisioning     401 send-push     401 weather
 *   401 story-still               200 news          405 check-user-exists
 *   ...  not one 404 in 63
 *
 * A 404 is what an undeployed function returns, so every one of them is live
 * on `bqwttemnnoexadpwifcj` — and `send-push`, absent from the MCP's list, is
 * certainly running, because FCM v1 delivers to 48 registered device tokens
 * through it. The MCP was describing a different database.
 *
 * That is what makes the trap expensive rather than merely confusing. A short
 * list reads exactly like "these are the ones deployed", so the natural next
 * move is to deploy the missing one — into a project nothing would ever call.
 * The trap runs the other way too: SQL run there returns real rows from a real
 * database that simply is not ONIQ's.
 *
 * Why it is set up that way, and why the fix is NOT to repoint it: production
 * is a Lovable Cloud project, so it lives in Lovable's Supabase organisation
 * rather than the owner's. `list_projects` on the owner's own credential
 * returns exactly one project and production is not in it — repointing the URL
 * would simply fail. The Lovable agent is the only thing holding the real
 * service role, which is why every deploy and every production query in this
 * repo goes through it.
 *
 * So this file records the split rather than trying to close it. If someone
 * later gives the MCP access to production, THIS TEST FAILS and the fact above
 * gets updated deliberately — which is the point.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** The project ONIQ actually runs on. */
const PRODUCTION_REF = "bqwttemnnoexadpwifcj";

/** The project the Supabase MCP is wired to, which is a different one. */
const MCP_REF = "nzbthoecadcwdoqxhaok";

/**
 * Pull every `<ref>.supabase.co` host out of a file.
 *
 * Deliberately a host match and nothing else: `.env` holds keys, and a test
 * that read broadly there would be one careless assertion message away from
 * printing one into a CI log.
 */
function refsIn(text: string): string[] {
  return [...text.matchAll(/\b([a-z]{20})\.supabase\.co\b/g)].map((m) => m[1]);
}

/** The MCP server's URL, or null when the wiring is absent. */
function mcpUrl(): URL | null {
  if (!existsSync(join(ROOT, ".mcp.json"))) return null;
  const parsed = JSON.parse(read(".mcp.json")) as {
    mcpServers?: Record<string, { url?: string }>;
  };
  const url = parsed.mcpServers?.supabase?.url;
  return url ? new URL(url) : null;
}

describe("every committed file agrees which project is production", () => {
  it("supabase/config.toml names it", () => {
    // This is the ref the CLI and the deploy bundler act on.
    expect(read("supabase/config.toml")).toMatch(
      new RegExp(`^project_id\\s*=\\s*"${PRODUCTION_REF}"`, "m"),
    );
  });

  it(".env points the built bundle at it", () => {
    // VITE_SUPABASE_URL is inlined at build time, so this is what a user's
    // browser actually connects to — the last word on "which project".
    const refs = refsIn(read(".env"));
    expect(refs.length).toBeGreaterThan(0);
    expect([...new Set(refs)]).toEqual([PRODUCTION_REF]);
  });

  it("the Lovable MCP manifest issues tokens for it", () => {
    expect(refsIn(read(".lovable/mcp/manifest.json"))).toContain(PRODUCTION_REF);
  });
});

describe("the Supabase MCP server is not looking at production", () => {
  it("is wired to a different project, and that is expected", () => {
    const url = mcpUrl();
    if (!url) return; // The wiring is optional; the hazard only exists with it.
    const ref = url.searchParams.get("project_ref");
    expect(ref).toBe(MCP_REF);
    expect(
      ref,
      "The Supabase MCP now reaches production. That is a real change, not a " +
        "typo — update the header of this file before relying on it.",
    ).not.toBe(PRODUCTION_REF);
  });

  it("cannot write, so a mix-up stays a wrong answer rather than a wrong deploy", () => {
    const url = mcpUrl();
    if (!url) return;
    // read_only is the second line of defence: it is what makes confusing the
    // two projects cost a round trip instead of a deploy into the wrong one.
    expect(url.searchParams.get("read_only")).toBe("true");
  });
});

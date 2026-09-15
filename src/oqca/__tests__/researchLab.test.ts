import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const edge = () => stripComments(readFileSync("supabase/functions/agi-research/index.ts", "utf8"));
const page = () => stripComments(readFileSync("src/routes/_authenticated/app.admin_.oqca.tsx", "utf8"));
const migration = () => stripComments(readFileSync("supabase/migrations/20260915130000_agi_research_write_requests.sql", "utf8"));
const agentMigration = () => stripComments(readFileSync("supabase/migrations/20260915134000_agi_research_agent_trigger.sql", "utf8"));

describe("ONIQ AGI Research Lab", () => {
  it("keeps credentials and GitHub calls on the server", () => {
    expect(page()).not.toMatch(/GITHUB_TOKEN|WORKSPACE_AGENT_ACCESS_TOKEN|api\.github\.com|api\.chatgpt\.com/);
    expect(edge()).toMatch(/ONIQ_RESEARCH_GITHUB_TOKEN/);
    expect(edge()).toMatch(/ONIQ_WORKSPACE_AGENT_ACCESS_TOKEN/);
    expect(edge()).toMatch(/api\.github\.com\/repos/);
    expect(edge()).toMatch(/api\.chatgpt\.com\/v1\/workspace_agents/);
  });

  it("re-derives admin authority before dispatching an action", () => {
    const source = edge();
    const gate = source.indexOf('rpc("is_admin"');
    const dispatch = source.indexOf('if (action === "capabilities")');
    expect(gate).toBeGreaterThan(0);
    expect(dispatch).toBeGreaterThan(gate);
    expect(source).toMatch(/403, \{ error: "Admins only" \}/);
  });

  it("bounds repository reads", () => {
    const source = edge();
    expect(source).toMatch(/const MAX_FILES = 6/);
    expect(source).toMatch(/const MAX_FILE_BYTES = 80_000/);
    expect(source).toMatch(/slice\(0, MAX_FILES\)/);
    expect(source).toMatch(/setTimeout\(\(\) => controller\.abort\(\), 12_000\)/);
  });

  it("permits only issues and requires a one-time unexpired confirmation", () => {
    const source = edge();
    expect(source).toMatch(/body\?\.kind !== "issue"/);
    expect(source).toMatch(/body\?\.confirmation !== CONFIRMATION_PHRASE/);
    expect(source).toMatch(/\.eq\("status", "pending"\)/);
    expect(source).toMatch(/\.gt\("expires_at"/);
    expect(source).not.toMatch(/\/git\/refs|\/contents|\/deployments/);
  });

  it("fails closed and consumes an agent trigger before the remote call", () => {
    const source = edge();
    const configGate = source.indexOf('if (kind === "agent_trigger" && !agentConfigured)');
    const consume = source.indexOf('.update({ status: "executing"');
    const remoteCall = source.indexOf("await triggerWorkspaceAgent(requestId");
    expect(configGate).toBeGreaterThan(0);
    expect(consume).toBeGreaterThan(configGate);
    expect(remoteCall).toBeGreaterThan(consume);
    expect(source).toMatch(/"Idempotency-Key": requestId/);
    expect(source).toMatch(/it will not be retried automatically/);
  });

  it("permits the agent trigger kind without opening browser access", () => {
    expect(agentMigration()).toMatch(/kind in \('issue', 'agent_trigger'\)/);
    expect(migration()).toMatch(/revoke all on table public\.agi_research_write_requests from anon, authenticated/i);
  });

  it("keeps confirmation rows inaccessible to browser roles", () => {
    const sql = migration();
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.agi_research_write_requests from anon, authenticated/i);
  });

  it("binds the published API channel and requires an exact one-time confirmation", () => {
    const source = edge();
    expect(source).toMatch(/agtch_6aa9492e2eec8191bbefd0c09127a457/);
    expect(source).toMatch(/RUN RESEARCH AGENT/);
    expect(source).toMatch(/\.eq\("kind", kind\)/);
    expect(source).toMatch(/\.eq\("status", "pending"\)/);
    expect(source).toMatch(/\.gt\("expires_at"/);
    expect(page()).toMatch(/five-minute, one-time confirmation/);
  });

  it("labels evidence as excerpts and keeps OQCA production tools at zero", () => {
    expect(page()).toMatch(/Results are excerpts, not claims of correctness/);
    expect(page()).toMatch(/production tool-call budget remains zero/);
  });
});

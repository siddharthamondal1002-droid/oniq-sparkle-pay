import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/test/sourceText";

const edge = () => stripComments(readFileSync("supabase/functions/agi-research/index.ts", "utf8"));
const page = () => stripComments(readFileSync("src/routes/_authenticated/app.admin_.oqca.tsx", "utf8"));
const migration = () => stripComments(readFileSync("supabase/migrations/20260915130000_agi_research_write_requests.sql", "utf8"));

describe("ONIQ AGI Research Lab", () => {
  it("keeps credentials and GitHub calls on the server", () => {
    expect(page()).not.toMatch(/GITHUB_TOKEN|api\.github\.com/);
    expect(edge()).toMatch(/ONIQ_RESEARCH_GITHUB_TOKEN/);
    expect(edge()).toMatch(/api\.github\.com\/repos/);
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

  it("keeps confirmation rows inaccessible to browser roles", () => {
    const sql = migration();
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/revoke all on table public\.agi_research_write_requests from anon, authenticated/i);
  });

  it("labels evidence as excerpts and keeps OQCA production tools at zero", () => {
    expect(page()).toMatch(/Results are excerpts, not claims of correctness/);
    expect(page()).toMatch(/production tool-call budget remains zero/);
  });
});

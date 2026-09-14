import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const WORKFLOW = readFileSync(
  resolve(root, ".github/workflows/story-worker-maintenance.yml"),
  "utf8",
);

function stripYamlComments(src: string): string {
  return src
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/, ""))
    .join("\n");
}

const SRC = stripYamlComments(WORKFLOW);
const TRIGGERS = SRC.slice(SRC.indexOf("on:"), SRC.indexOf("permissions:"));

describe("story worker maintenance workflow stays read-only and records the right facts", () => {
  it("runs only on a manual trigger plus a low-risk schedule", () => {
    expect(TRIGGERS).toContain("workflow_dispatch:");
    expect(TRIGGERS).toContain('cron: "17 6 * * *"');
    expect(TRIGGERS).not.toContain("repository_dispatch:");
    expect(TRIGGERS).not.toContain("push:");
  });

  it("keeps GitHub permissions read-only", () => {
    expect(SRC).toMatch(/permissions:\s*[\s\S]*actions:\s*read/);
    expect(SRC).toMatch(/permissions:\s*[\s\S]*contents:\s*read/);
    expect(SRC).not.toMatch(/permissions:\s*[\s\S]*contents:\s*write/);
  });

  it("checks out main explicitly and records the actual checked-out sha", () => {
    expect(SRC).toMatch(/uses:\s*actions\/checkout@v5/);
    expect(SRC).toMatch(/ref:\s*refs\/heads\/main/);
    expect(SRC).toMatch(/git", "rev-parse", "HEAD"/);
  });

  it("inspects the story-worker workflow semantics and the requested run", () => {
    expect(SRC).toContain("INSPECTED_RUN_ID");
    expect(SRC).toContain('/actions/runs/{run_id}');
    expect(SRC).toContain('/actions/runs/{run_id}/jobs?per_page=20');
    expect(SRC).toContain("checkout_has_explicit_ref");
    expect(SRC).toContain("has_repository_dispatch");
    expect(SRC).toContain("has_workflow_dispatch");
  });

  it("publishes both a step summary and an artifact record bundle", () => {
    expect(SRC).toContain('cat out/summary.md >> "$GITHUB_STEP_SUMMARY"');
    expect(SRC).toContain("actions/upload-artifact@v4");
    expect(SRC).toContain("story-worker-maintenance-records-");
    expect(SRC).toContain("story-worker-maintenance.json");
  });

  it("never dispatches the story worker or touches production credentials", () => {
    expect(SRC).not.toContain("story-job");
    expect(SRC).not.toContain("repository_dispatches");
    expect(SRC).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(SRC).not.toContain("STORY_JOB_SECRET");
  });
});

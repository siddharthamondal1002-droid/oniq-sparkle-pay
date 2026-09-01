/**
 * The GPU harness lives in oniq-gpu-worker, and nowhere else.
 *
 * WHY THIS GUARD EXISTS. On 2026-08-25 a copy of the harness was vendored
 * into this repository as `gpu-validation/`, because the RunPod Actions
 * secret lived here and the gated pipeline had to run where the key was.
 * The workflow header described it as "byte-identical to
 * oniq-gpu-worker@f9f79a6, where it is tested"; the ledger, written a day
 * apart, pinned it to e708d79. Two pins for one copy was the first sign.
 *
 * MEASURED 2026-09-01, six days later:
 *
 *     runpod_client.py    471 lines vendored, 1191 live   (720 behind)
 *     validation modules  3 vendored, 42 live
 *     commits behind      197
 *     TARGET_GPU          "NVIDIA GeForce RTX 3090" — a card ONIQ had
 *                         stopped renting, replaced by A40 / RTX A6000
 *
 * None of the volume, datacenter or template work of that week existed in
 * the copy: no attach_network_volume, no set_data_center_ids, no
 * delete_network_volume, no set_execution_timeout. A file that CLAIMS byte
 * identity and has drifted is worse than no copy at all, because the claim
 * is what stops anyone checking it.
 *
 * OWNER DIRECTIVE 2026-09-01: delete it, and let the gpu repo be the only
 * place the harness exists. The premise that justified vendoring is gone
 * anyway — oniq-gpu-worker now holds its own RunPod secret and its own
 * gpu-spend environment, and every write of 2026-09-01 (volume attach and
 * delete, the locations un-pin, the template retarget) was dispatched from
 * there. A full repository merge is a deliberate separate piece of work,
 * because it requires rewriting the spend gate that currently reads "this
 * workflow must remain the ONLY one in the repo that references
 * secrets.RUNPOD_API_KEY" — and that gate is what stops a Lovable sync
 * commit renting a GPU.
 *
 * The ledger's historical entries are NOT rewritten. They record what was
 * true when they were written; a dated entry records the removal instead.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const REPO = new URL("../../../", import.meta.url);

describe("the GPU harness is not vendored into the app repository", () => {
  it("has no gpu-validation/ directory", () => {
    expect(existsSync(new URL("gpu-validation", REPO))).toBe(false);
  });

  it("has no Actions workflow that can reach RunPod", () => {
    // The runtime key in src/ and supabase/functions/ is a DIFFERENT thing:
    // it lives in the server's environment and is what the product calls the
    // endpoint with. This asserts only that no GitHub Actions workflow here
    // carries the Actions secret — that pipeline belongs to oniq-gpu-worker.
    const dir = new URL(".github/workflows/", REPO);
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
      .filter((name) =>
        readFileSync(new URL(name, dir), "utf8").includes("secrets.RUNPOD_API_KEY"),
      );
    expect(offenders).toEqual([]);
  });

  it("keeps the ledger's history intact", () => {
    // The removal is recorded by ADDING a dated entry. Editing the
    // 2026-08-25/26 entries to match today would destroy the record of why
    // the vendoring happened, which is the part worth keeping.
    const ledger = readFileSync(new URL("docs/video/ONIQ_AI_FINANCIAL_CONTROL.md", REPO), "utf8");
    expect(ledger).toContain("2026-08-25");
    expect(ledger).toContain("2026-09-01");
  });
});

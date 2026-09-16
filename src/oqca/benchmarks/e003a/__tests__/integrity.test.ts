import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  bindingDigest,
  verifyArtifact,
  verifyExperimentChain,
  type ArtifactBinding,
  type SignedArtifact,
} from "../integrity.ts";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const trusted = [
  {
    id: "custodian-1",
    public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  },
];
const hex = (value: string) => createHash("sha256").update(value).digest("hex");
const common = {
  schema_version: "1.0",
  repository_sha: "0".repeat(40),
  environment_sha256: hex("env"),
  dependency_lock_sha256: hex("lock"),
  adapter_sha256: hex("adapter"),
  prompt_sha256: hex("prompt"),
  tool_catalog_sha256: hex("tools"),
  task_manifest_sha256: hex("tasks"),
  thresholds_sha256: hex("thresholds"),
  evaluator_sha256: hex("evaluator"),
} as const;

function signBinding(binding: ArtifactBinding): SignedArtifact {
  const digest = bindingDigest(binding);
  return {
    binding,
    seal: {
      algorithm: "sha256+ed25519",
      digest,
      key_id: "custodian-1",
      signature_base64: sign(null, Buffer.from(digest), privateKey).toString("base64"),
    },
  };
}

function chain() {
  const runner = signBinding({ ...common, artifact_id: "runner-1", role: "runner" });
  const evaluator = signBinding({ ...common, artifact_id: "evaluator-1", role: "evaluator" });
  const output = signBinding({
    ...common,
    artifact_id: "output-1",
    role: "output",
    runner_manifest_sha256: bindingDigest(runner.binding),
    evaluator_manifest_sha256: bindingDigest(evaluator.binding),
    output_bundle_sha256: hex("output"),
  });
  return { runner, evaluator, output };
}

describe("E-003A sealed artifact chain", () => {
  it("accepts pre-run manifests and their bound post-run output", () => {
    const { runner, evaluator, output } = chain();
    expect(() => verifyExperimentChain(runner, evaluator, output, trusted)).not.toThrow();
  });

  it("rejects a modified binding before evaluating it", () => {
    const { runner } = chain();
    const tampered: SignedArtifact = {
      ...runner,
      binding: { ...runner.binding, prompt_sha256: hex("changed") },
    };
    expect(() => verifyArtifact(tampered, trusted)).toThrow(/digest mismatch/);
  });

  it("rejects a valid signature from a key outside the trust set", () => {
    const { runner } = chain();
    expect(() => verifyArtifact(runner, [])).toThrow(/untrusted signing key/);
  });

  it("rejects a post-run output bound to different manifests", () => {
    const { runner, evaluator, output } = chain();
    if (output.binding.role !== "output") throw new Error("fixture role");
    const binding: ArtifactBinding = {
      ...output.binding,
      runner_manifest_sha256: hex("different-runner"),
    };
    const swapped = signBinding(binding);
    expect(() => verifyExperimentChain(runner, evaluator, swapped, trusted)).toThrow(
      /does not bind/,
    );
  });

  it("rejects malformed commit and component digests", () => {
    const { runner, output } = chain();
    expect(() =>
      verifyArtifact(
        { ...runner, binding: { ...runner.binding, repository_sha: "short" } },
        trusted,
      ),
    ).toThrow(/repository_sha/);
    if (output.binding.role !== "output") throw new Error("fixture role");
    expect(() =>
      verifyArtifact(
        { ...output, binding: { ...output.binding, output_bundle_sha256: "short" } },
        trusted,
      ),
    ).toThrow(/output_bundle_sha256/);
  });
});

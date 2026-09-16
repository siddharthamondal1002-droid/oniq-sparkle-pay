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
  output_bundle_sha256: hex("output"),
} as const;

function artifact(role: ArtifactBinding["role"]): SignedArtifact {
  const binding: ArtifactBinding = { ...common, artifact_id: `${role}-1`, role };
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

describe("E-003A sealed artifact chain", () => {
  it("accepts matching artifacts signed by the custodian", () => {
    expect(() =>
      verifyExperimentChain(artifact("runner"), artifact("evaluator"), artifact("output"), trusted),
    ).not.toThrow();
  });

  it("rejects a modified binding before evaluating it", () => {
    const runner = artifact("runner");
    const tampered: SignedArtifact = {
      ...runner,
      binding: { ...runner.binding, prompt_sha256: hex("changed") },
    };
    expect(() => verifyArtifact(tampered, trusted)).toThrow(/digest mismatch/);
  });

  it("rejects a valid signature from a key outside the trust set", () => {
    expect(() => verifyArtifact(artifact("runner"), [])).toThrow(/untrusted signing key/);
  });

  it("rejects an output swapped from another run even when separately signed", () => {
    const output = artifact("output");
    const binding: ArtifactBinding = {
      ...output.binding,
      output_bundle_sha256: hex("other-output"),
    };
    const digest = bindingDigest(binding);
    const swapped: SignedArtifact = {
      binding,
      seal: {
        ...output.seal,
        digest,
        signature_base64: sign(null, Buffer.from(digest), privateKey).toString("base64"),
      },
    };
    expect(() =>
      verifyExperimentChain(artifact("runner"), artifact("evaluator"), swapped, trusted),
    ).toThrow(/chain mismatch/);
  });

  it("rejects malformed commit and component digests", () => {
    const runner = artifact("runner");
    expect(() =>
      verifyArtifact(
        { ...runner, binding: { ...runner.binding, repository_sha: "short" } },
        trusted,
      ),
    ).toThrow(/repository_sha/);
    expect(() =>
      verifyArtifact(
        { ...runner, binding: { ...runner.binding, tool_catalog_sha256: "short" } },
        trusted,
      ),
    ).toThrow(/tool_catalog_sha256/);
  });
});

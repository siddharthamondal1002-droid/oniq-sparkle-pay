import { createHash, verify } from "node:crypto";

export type ArtifactBinding = {
  readonly schema_version: "1.0";
  readonly artifact_id: string;
  readonly role: "runner" | "evaluator" | "output";
  readonly repository_sha: string;
  readonly environment_sha256: string;
  readonly dependency_lock_sha256: string;
  readonly adapter_sha256: string;
  readonly prompt_sha256: string;
  readonly tool_catalog_sha256: string;
  readonly task_manifest_sha256: string;
  readonly thresholds_sha256: string;
  readonly evaluator_sha256: string;
  readonly output_bundle_sha256: string;
};

export type SignedArtifact = {
  readonly binding: ArtifactBinding;
  readonly seal: {
    readonly algorithm: "sha256+ed25519";
    readonly digest: string;
    readonly key_id: string;
    readonly signature_base64: string;
  };
};

export type TrustedKey = {
  readonly id: string;
  readonly public_key_pem: string;
};

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export function bindingDigest(binding: ArtifactBinding): string {
  return createHash("sha256").update(canonicalJson(binding), "utf8").digest("hex");
}

function requireSha256(value: string, path: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${path} must be 64 lowercase hex characters`);
  }
}

export function validateBinding(binding: ArtifactBinding): void {
  if (binding.schema_version !== "1.0") throw new Error("unsupported artifact schema_version");
  if (!binding.artifact_id.trim()) throw new Error("artifact_id is required");
  if (!/^[a-f0-9]{40}$/.test(binding.repository_sha)) {
    throw new Error("repository_sha must be a full lowercase commit SHA");
  }
  for (const [key, value] of Object.entries(binding)) {
    if (key.endsWith("_sha256")) requireSha256(String(value), key);
  }
}

export function verifyArtifact(
  artifact: SignedArtifact,
  trustedKeys: readonly TrustedKey[],
): string {
  validateBinding(artifact.binding);
  if (artifact.seal.algorithm !== "sha256+ed25519") {
    throw new Error("unsupported seal algorithm");
  }
  requireSha256(artifact.seal.digest, "seal.digest");
  const digest = bindingDigest(artifact.binding);
  if (digest !== artifact.seal.digest) throw new Error("artifact digest mismatch");
  const key = trustedKeys.find((candidate) => candidate.id === artifact.seal.key_id);
  if (!key) throw new Error(`untrusted signing key ${artifact.seal.key_id}`);
  const signature = Buffer.from(artifact.seal.signature_base64, "base64");
  if (
    signature.length === 0 ||
    !verify(null, Buffer.from(digest, "utf8"), key.public_key_pem, signature)
  ) {
    throw new Error("artifact signature verification failed");
  }
  return digest;
}

/** Cross-role bindings prevent swapping outputs or evaluators after execution. */
export function verifyExperimentChain(
  runner: SignedArtifact,
  evaluator: SignedArtifact,
  output: SignedArtifact,
  trustedKeys: readonly TrustedKey[],
): void {
  verifyArtifact(runner, trustedKeys);
  verifyArtifact(evaluator, trustedKeys);
  verifyArtifact(output, trustedKeys);
  if (
    runner.binding.role !== "runner" ||
    evaluator.binding.role !== "evaluator" ||
    output.binding.role !== "output"
  ) {
    throw new Error("artifact role mismatch");
  }
  const shared = [
    "repository_sha",
    "environment_sha256",
    "dependency_lock_sha256",
    "adapter_sha256",
    "prompt_sha256",
    "tool_catalog_sha256",
    "task_manifest_sha256",
    "thresholds_sha256",
    "evaluator_sha256",
    "output_bundle_sha256",
  ] as const;
  for (const key of shared) {
    if (
      runner.binding[key] !== evaluator.binding[key] ||
      runner.binding[key] !== output.binding[key]
    ) {
      throw new Error(`artifact chain mismatch at ${key}`);
    }
  }
}

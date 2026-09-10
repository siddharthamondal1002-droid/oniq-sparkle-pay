/**
 * OQCA v1.1 — reading manifests off disk. Kept SEPARATE from `runner.ts` so
 * that `node:fs` appears in exactly one file of the subsystem: the runner, the
 * arms and the statistics are then importable anywhere, and a future caller in
 * a browser-shaped context cannot pull a filesystem in by accident.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseManifest, type BenchmarkManifest } from "./manifest";

export const BENCHMARK_ROOT = "src/oqca/benchmarks";

export function loadManifestFile(path: string): BenchmarkManifest {
  return parseManifest(JSON.parse(readFileSync(path, "utf8")));
}

/** Every `*.json` under `<root>/<family>/`, sorted so a run is reproducible. */
export function loadAllManifests(root = BENCHMARK_ROOT): BenchmarkManifest[] {
  const out: BenchmarkManifest[] = [];
  for (const family of readdirSync(root).sort()) {
    const dir = join(root, family);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      out.push(loadManifestFile(join(dir, file)));
    }
  }
  return out;
}

/** The declared families, including the ones deliberately holding no manifest. */
export function listFamilies(root = BENCHMARK_ROOT): string[] {
  return readdirSync(root)
    .filter((f) => statSync(join(root, f)).isDirectory())
    .sort();
}

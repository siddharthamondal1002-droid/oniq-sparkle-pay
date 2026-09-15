import { readFileSync } from "node:fs";
import { parseSealedFixture, parseThresholds, type GroundingThresholds } from "./schema.ts";

export function loadSealedFixture(path: string) {
  return parseSealedFixture(JSON.parse(readFileSync(path, "utf8")));
}

export function loadThresholdOverrides(path: string): Partial<GroundingThresholds> {
  return parseThresholds(JSON.parse(readFileSync(path, "utf8")));
}

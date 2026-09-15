import { readFileSync } from "node:fs";
import { parseRun, parseSuite, parseThresholds } from "./schema.ts";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadGroundingSuite(path: string) {
  return parseSuite(readJson(path));
}

export function loadGroundingRun(path: string) {
  return parseRun(readJson(path));
}

export function loadGroundingThresholds(path: string) {
  return parseThresholds(readJson(path));
}

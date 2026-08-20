export const MAX_QC_REPORT_BYTES = 200_000;
const MAX_SHOTS = 240;
const MAX_FINDINGS = 400;
const MAX_CHECKS_PER_SHOT = 64;

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = 300): string {
  return String(v ?? "").slice(0, max);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonBytes(v: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(v)).length;
  } catch {
    return MAX_QC_REPORT_BYTES + 1;
  }
}

function cleanChecks(v: unknown): unknown[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, MAX_CHECKS_PER_SHOT).map((c) => {
    const o = isObject(c) ? c : {};
    return {
      name: str(o.name, 80),
      pass: Boolean(o.pass),
      detail: str(o.detail, 240),
    };
  });
}

function cleanShot(v: unknown): JsonObject {
  const o = isObject(v) ? v : {};
  return {
    shot: num(o.shot),
    attempt: num(o.attempt, 1),
    passed: Boolean(o.passed),
    score: Math.max(0, Math.min(100, num(o.score))),
    checks: cleanChecks(o.checks),
    metrics: isObject(o.metrics) ? o.metrics : {},
    createdAt: str(o.createdAt, 64),
    continuity: isObject(o.continuity) ? o.continuity : {},
    visual: isObject(o.visual) ? o.visual : {},
    cinematic: isObject(o.cinematic) ? o.cinematic : {},
    recommendation: str(o.recommendation, 180),
  };
}

function cleanFinding(v: unknown): JsonObject {
  const o = isObject(v) ? v : {};
  return {
    severity: str(o.severity, 16),
    category: str(o.category, 40),
    evidence: str(o.evidence, 320),
    confidence: Math.max(0, Math.min(1, num(o.confidence, 0))),
    affectedShotIds: Array.isArray(o.affectedShotIds)
      ? o.affectedShotIds.slice(0, 20).map((x) => num(x))
      : [],
    recommendedAction: str(o.recommendedAction, 220),
    status: str(o.status, 16),
  };
}

export function sanitizeQcReport(report: unknown):
  | { ok: true; report: JsonObject }
  | { ok: false; error: string } {
  if (!isObject(report)) return { ok: false, error: "qc report must be an object" };
  if (safeJsonBytes(report) > MAX_QC_REPORT_BYTES) {
    return { ok: false, error: "qc report too large" };
  }
  const shots = Array.isArray(report.shots) ? report.shots.slice(0, MAX_SHOTS).map(cleanShot) : [];
  const failures = Array.isArray(report.failures)
    ? report.failures.slice(0, MAX_FINDINGS).map(cleanFinding)
    : [];
  const warnings = Array.isArray(report.warnings)
    ? report.warnings.slice(0, MAX_FINDINGS).map(cleanFinding)
    : [];
  const cleaned: JsonObject = {
    version: num(report.version, 1),
    stage: str(report.stage, 80),
    technical: isObject(report.technical) ? report.technical : {},
    visual: isObject(report.visual) ? report.visual : {},
    continuity: isObject(report.continuity) ? report.continuity : {},
    audio: isObject(report.audio) ? report.audio : {},
    score: isObject(report.score) ? report.score : {},
    failures,
    warnings,
    recommendation: str(report.recommendation, 220),
    shots,
    shotMap: isObject(report.shotMap) ? report.shotMap : undefined,
    editorialProject: isObject(report.editorialProject) ? report.editorialProject : undefined,
    updatedAt: str(report.updatedAt, 64),
  };
  if (safeJsonBytes(cleaned) > MAX_QC_REPORT_BYTES) {
    return { ok: false, error: "qc report exceeds storage limit after sanitization" };
  }
  return { ok: true, report: cleaned };
}

export type QcStatus = "PASS" | "WARN" | "FAIL" | "REGENERATE";

export type ContinuityCategory =
  | "character"
  | "location"
  | "props"
  | "wardrobe"
  | "lighting"
  | "temporal"
  | "camera";

export type ContinuityFinding = {
  severity: "low" | "medium" | "high";
  category: ContinuityCategory;
  evidence: string;
  confidence: number;
  affectedShotIds: number[];
  recommendedAction: string;
  status: QcStatus;
};

export type ProductionState = {
  productionBible: string;
  characterBible: Record<string, string>;
  locationBible: string;
  propBible: Record<string, string>;
  wardrobeState: Record<string, string>;
  sceneState: { order: number[] };
  shotState: Array<{ shotId: number; still: string; narration: string; acceptedAt: string }>;
};

type Scored = { score: number; status: QcStatus; findings: ContinuityFinding[] };

const CHANGE_MARKERS = /\b(now|suddenly|later|next|after|meanwhile|changes?|switch(?:es|ed)?|new|transitions?)\b/i;
const WORD = /[a-z0-9]+/gi;

function words(input: string): Set<string> {
  const out = new Set<string>();
  for (const token of (input.toLowerCase().match(WORD) ?? [])) out.add(token);
  return out;
}

function overlap(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let hit = 0;
  left.forEach((w) => {
    if (right.has(w)) hit += 1;
  });
  return hit / Math.max(left.size, right.size);
}

function statusFor(score: number): QcStatus {
  if (score >= 80) return "PASS";
  if (score >= 60) return "WARN";
  if (score >= 45) return "REGENERATE";
  return "FAIL";
}

export function createProductionState(plan: {
  setting?: string;
  cast?: Array<{ name?: string; lock?: string }>;
}): ProductionState {
  const characterBible: Record<string, string> = {};
  for (const c of plan.cast ?? []) {
    const name = String(c?.name ?? "").trim();
    const lock = String(c?.lock ?? "").trim();
    if (name && lock) characterBible[name] = lock;
  }
  return {
    productionBible: String(plan.setting ?? "").trim(),
    characterBible,
    locationBible: String(plan.setting ?? "").trim(),
    propBible: {},
    wardrobeState: {},
    sceneState: { order: [] },
    shotState: [],
  };
}

export function evaluateContinuity(input: {
  shotIndex: number;
  shotStill: string;
  shotNarration: string;
  shotMotion?: string | null;
  previousAcceptedShot?: { id: number; still: string; narration: string } | null;
  nextPlannedShot?: { still?: string; narration?: string } | null;
  characterBible?: Record<string, string>;
}): Scored {
  const findings: ContinuityFinding[] = [];
  let score = 100;
  const shotId = input.shotIndex + 1;
  const frameText = `${input.shotStill} ${input.shotNarration}`.trim();
  const intentional =
    CHANGE_MARKERS.test(frameText) ||
    CHANGE_MARKERS.test(`${input.nextPlannedShot?.still ?? ""} ${input.nextPlannedShot?.narration ?? ""}`);

  if (input.previousAcceptedShot) {
    const prevText = `${input.previousAcceptedShot.still} ${input.previousAcceptedShot.narration}`;
    const s = overlap(frameText, prevText);
    if (s < 0.08 && !intentional) {
      score -= 30;
      findings.push({
        severity: "high",
        category: "location",
        evidence: "Low textual overlap with previous accepted shot without explicit transition intent.",
        confidence: 0.74,
        affectedShotIds: [input.previousAcceptedShot.id, shotId],
        recommendedAction: "Reinforce previous accepted location and scene context in regeneration constraints.",
        status: "REGENERATE",
      });
    } else if (s < 0.15) {
      score -= 12;
      findings.push({
        severity: "medium",
        category: "temporal",
        evidence: "Continuity changed but a transition cue is present; likely intentional.",
        confidence: 0.56,
        affectedShotIds: [input.previousAcceptedShot.id, shotId],
        recommendedAction: "Keep transition intent explicit in next shot prompt.",
        status: "WARN",
      });
    }
  }

  const locks = Object.entries(input.characterBible ?? {});
  for (const [name, lock] of locks) {
    const inShot = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(frameText);
    if (!inShot) continue;
    const lockMatch = overlap(frameText, lock);
    if (lockMatch < 0.08 && !intentional) {
      score -= 18;
      findings.push({
        severity: "medium",
        category: "character",
        evidence: `Character ${name} appears without matching lock cues.`,
        confidence: 0.69,
        affectedShotIds: [shotId],
        recommendedAction: `Repeat ${name}'s lock details verbatim in still constraints.`,
        status: "REGENERATE",
      });
    }
  }

  const motion = String(input.shotMotion ?? "");
  if (/\bpan left\b/i.test(motion) && /\bpan right\b/i.test(motion)) {
    score -= 10;
    findings.push({
      severity: "low",
      category: "camera",
      evidence: "Conflicting camera direction cues were detected in one shot.",
      confidence: 0.79,
      affectedShotIds: [shotId],
      recommendedAction: "Keep one dominant camera direction in the regenerated motion prompt.",
      status: "WARN",
    });
  }

  score = Math.max(0, Math.min(100, score));
  return { score, status: statusFor(score), findings };
}

export function evaluateVisualQuality(input: {
  stillLuma?: number;
  clipLuma?: number;
  clipFps?: number;
}): { score: number; findings: ContinuityFinding[]; status: QcStatus } {
  let score = 100;
  const findings: ContinuityFinding[] = [];
  const lumas = [input.stillLuma, input.clipLuma].filter((x): x is number => Number.isFinite(x));
  if (lumas.some((l) => l < 12 || l > 245)) {
    score -= 20;
    findings.push({
      severity: "medium",
      category: "lighting",
      evidence: `Luma outlier detected (${lumas.map((x) => x.toFixed(1)).join(", ")}).`,
      confidence: 0.8,
      affectedShotIds: [],
      recommendedAction: "Regenerate with exposure/visibility constraints.",
      status: "REGENERATE",
    });
  }
  if (Number.isFinite(input.clipFps) && (input.clipFps as number) < 18) {
    score -= 16;
    findings.push({
      severity: "medium",
      category: "camera",
      evidence: `Low clip fps ${(input.clipFps as number).toFixed(2)} may appear stuttery.`,
      confidence: 0.88,
      affectedShotIds: [],
      recommendedAction: "Regenerate clip with stronger motion smoothness requirement.",
      status: "REGENERATE",
    });
  }
  score = Math.max(0, Math.min(100, score));
  return { score, findings, status: statusFor(score) };
}

export function evaluateCinematicQuality(input: {
  technicalScore: number;
  continuityScore: number;
  hasSubjectCue: boolean;
  hasMotionCue: boolean;
  framing?: { figureHeight?: number; travel?: number; pan?: number } | null;
}): { score: number; status: QcStatus; findings: ContinuityFinding[] } {
  const findings: ContinuityFinding[] = [];
  let score = Math.round(input.technicalScore * 0.45 + input.continuityScore * 0.35);
  if (input.hasSubjectCue) score += 10;
  if (input.hasMotionCue) score += 6;
  if ((input.framing?.figureHeight ?? 0) > 0.82) {
    score -= 8;
    findings.push({
      severity: "low",
      category: "camera",
      evidence: "Subject occupies most of the frame; readability may suffer.",
      confidence: 0.58,
      affectedShotIds: [],
      recommendedAction: "Consider a looser framing in regeneration constraints.",
      status: "WARN",
    });
  }
  if (Math.abs(input.framing?.pan ?? 0) > 0.9 && !input.hasMotionCue) {
    score -= 6;
    findings.push({
      severity: "low",
      category: "camera",
      evidence: "Strong camera movement without explicit purpose cue.",
      confidence: 0.53,
      affectedShotIds: [],
      recommendedAction: "Prefer intentional camera move language (push/pan/tilt/tracking).",
      status: "WARN",
    });
  }
  score = Math.max(0, Math.min(100, score));
  return { score, status: statusFor(score), findings };
}

export function classifyRegenerationNeeds(input: {
  failedCheckNames: string[];
  continuityStatus: QcStatus;
  continuityFindings: ContinuityFinding[];
  cinematicStatus: QcStatus;
}): {
  cause: string;
  focus: Array<"still" | "audio" | "clip" | "continuity" | "camera">;
  constraints: string[];
} {
  const failed = new Set(input.failedCheckNames);
  const focus: Array<"still" | "audio" | "clip" | "continuity" | "camera"> = [];
  const constraints: string[] = [];

  if ([...failed].some((n) => n.startsWith("audio."))) {
    focus.push("audio");
    constraints.push("regenerate narration/dialogue audio first; preserve accepted visuals where possible");
  }
  if ([...failed].some((n) => n.startsWith("still."))) {
    focus.push("still");
    constraints.push("enforce subject visibility and exposure in still prompt");
  }
  if ([...failed].some((n) => n.startsWith("clip."))) {
    focus.push("clip");
    constraints.push("tighten clip fps/duration/resolution and preserve screen direction");
  }
  if (input.continuityStatus === "FAIL" || input.continuityStatus === "REGENERATE") {
    focus.push("continuity");
    constraints.push(...input.continuityFindings.slice(0, 2).map((f) => f.recommendedAction));
  }
  if (input.cinematicStatus === "REGENERATE") {
    focus.push("camera");
    constraints.push("adjust framing and camera language; avoid unnecessary motion");
  }

  const uniqFocus = [...new Set(focus)];
  const uniqConstraints = [...new Set(constraints)];
  return {
    cause: uniqFocus.join("+") || "technical",
    focus: uniqFocus.length ? uniqFocus : ["still"],
    constraints: uniqConstraints.length ? uniqConstraints : ["repeat prior accepted shot context"],
  };
}

export function selectBestCandidate<T extends {
  technicalScore: number;
  continuityScore: number;
  cinematicScore: number;
  storyRelevance: number;
  audioCompatibility: number;
  generationConfidence: number;
}>(candidates: T[]): { winner: T | null; ranked: Array<T & { composite: number }> } {
  const ranked = candidates
    .map((c) => ({
      ...c,
      composite: Number(
        (
          c.technicalScore * 0.35 +
          c.continuityScore * 0.2 +
          c.cinematicScore * 0.18 +
          c.storyRelevance * 0.15 +
          c.audioCompatibility * 0.07 +
          c.generationConfidence * 0.05
        ).toFixed(2),
      ),
    }))
    .sort((a, b) => b.composite - a.composite);
  return { winner: ranked[0] ?? null, ranked };
}

export function updateProductionStateWithAcceptedShot(
  state: ProductionState,
  input: {
    shotId: number;
    still: string;
    narration: string;
    cast?: Array<{ name?: string; lock?: string }>;
  },
): ProductionState {
  const next: ProductionState = JSON.parse(JSON.stringify(state)) as ProductionState;
  next.shotState.push({
    shotId: input.shotId,
    still: input.still,
    narration: input.narration,
    acceptedAt: new Date().toISOString(),
  });
  next.sceneState.order.push(input.shotId);
  for (const c of input.cast ?? []) {
    const name = String(c?.name ?? "").trim();
    const lock = String(c?.lock ?? "").trim();
    if (name && lock) {
      next.characterBible[name] = lock;
      if (/wear(?:ing)?\s+([^.,;]+)/i.test(lock)) {
        next.wardrobeState[name] = lock;
      }
    }
  }
  return next;
}

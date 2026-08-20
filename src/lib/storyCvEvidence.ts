export type EvidenceSource = "ffmpeg" | "ffprobe" | "opencv" | "pyscenedetect" | "heuristic" | "unknown";
export type EvidenceState = "OBSERVED" | "INFERRED" | "UNKNOWN";

export type BoundedSamplingInfo = {
  bounded: boolean;
  strategy: "first-middle-last-adaptive" | "unknown";
  maxSamples: number;
  actualSamples: number;
  maxDurationMs: number;
  sampleScale: string;
};

export type EvidenceProvenance = {
  method: string;
  sourceDetail?: string;
};

export type EvidenceConfidence<T> = {
  value: T;
  confidence: number;
  source: EvidenceSource | string;
  state?: EvidenceState;
  provenance?: EvidenceProvenance;
  sampling?: BoundedSamplingInfo;
  timestampMs?: number;
  frameNumber?: number;
  detector?: { name: string; version: string };
};

export type FrameSample = {
  timestampMs: number;
  frameNumber?: number;
  width: number;
  height: number;
  reason: "first" | "middle" | "last" | "cut-near" | "adaptive";
};

export type VisualEvidence = {
  version: 1;
  contractVersion: 1;
  sampling: BoundedSamplingInfo;
  media: {
    kind: "still" | "clip" | "unknown";
    pathHash: string;
    codec?: string;
    width?: number;
    height?: number;
  };
  timing: {
    durationMs?: number;
    fps?: number;
    vfr: EvidenceConfidence<boolean>;
  };
  sceneCuts: {
    observedCutTimestampsMs: number[];
    transitionHints: Array<"cut" | "fade" | "unknown">;
    confidence: number;
    source: EvidenceSource | string;
  };
  frames: FrameSample[];
  composition: {
    shotScale: EvidenceConfidence<"close" | "medium" | "wide" | "unknown">;
    framingStability: EvidenceConfidence<"stable" | "moving" | "unknown">;
  };
  color: {
    luminance: EvidenceConfidence<number>;
    saturation: EvidenceConfidence<number>;
    contrast: EvidenceConfidence<number>;
    dominantColors: EvidenceConfidence<string[]>;
    histogramSimilarityToPrevious?: EvidenceConfidence<number>;
  };
  motion: {
    magnitude: EvidenceConfidence<number>;
    dominantDirection: EvidenceConfidence<"left_to_right" | "right_to_left" | "mixed" | "static" | "unknown">;
    cameraMovement: EvidenceConfidence<"static" | "moving" | "unknown">;
  };
  subjects: {
    personDetected: EvidenceConfidence<boolean | null>;
    appearanceEmbeddingAvailable: EvidenceConfidence<boolean>;
    identity: EvidenceConfidence<string>;
    wardrobe: {
      dominantColors: EvidenceConfidence<string[]>;
      changeVsPrevious?: EvidenceConfidence<"MATCH" | "POSSIBLE_CHANGE" | "LIKELY_CHANGE" | "UNKNOWN">;
    };
  };
  faces: {
    detected: EvidenceConfidence<boolean | null>;
    count: EvidenceConfidence<number | null>;
    boxes: EvidenceConfidence<Array<{ x: number; y: number; w: number; h: number }> | null>;
  };
  objects: {
    detected: EvidenceConfidence<boolean | null>;
    labels: EvidenceConfidence<string[] | null>;
  };
  location: {
    environmentSimilarityToPrevious?: EvidenceConfidence<number>;
    indoorOutdoorSignal: EvidenceConfidence<"indoor" | "outdoor" | "unknown">;
  };
  screenDirection: EvidenceConfidence<"left_to_right" | "right_to_left" | "mixed" | "static" | "unknown">;
  confidence: number;
};

export type ShotObservationClassification = "MATCH" | "MINOR_DRIFT" | "MISMATCH" | "UNKNOWN";

export type ShotBoundaryObservation = {
  expectedShotId: number;
  observedCutCount: number;
  expectedDurationMs?: number;
  observedDurationMs?: number;
  classification: ShotObservationClassification;
  confidence: number;
  reasons: string[];
};

export function boundedConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function evidenceStateFor(input: {
  source: EvidenceSource | string;
  confidence: number;
  value: unknown;
}): EvidenceState {
  const confidence = boundedConfidence(input.confidence);
  if (confidence <= 0) return "UNKNOWN";
  if (input.source === "unknown") return "UNKNOWN";
  if (typeof input.value === "string" && input.value.toUpperCase() === "UNKNOWN") return "UNKNOWN";
  return input.source === "heuristic" ? "INFERRED" : "OBSERVED";
}

export function safePathHash(pathLike: string): string {
  let h = 2166136261;
  for (let i = 0; i < pathLike.length; i += 1) {
    h ^= pathLike.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a-${(h >>> 0).toString(16)}`;
}

export function classifyShotObservation(input: {
  expectedShotId: number;
  expectedDurationMs?: number;
  observedDurationMs?: number;
  observedCutCount: number;
  evidenceConfidence: number;
}): ShotBoundaryObservation {
  const reasons: string[] = [];
  const cutCount = Math.max(0, Math.trunc(input.observedCutCount));
  const c = boundedConfidence(input.evidenceConfidence);

  let durationDrift = 0;
  if (Number.isFinite(input.expectedDurationMs) && Number.isFinite(input.observedDurationMs) && (input.expectedDurationMs as number) > 0) {
    durationDrift =
      Math.abs((input.observedDurationMs as number) - (input.expectedDurationMs as number)) /
      (input.expectedDurationMs as number);
  }

  let classification: ShotObservationClassification = "UNKNOWN";
  if (c < 0.45) {
    classification = "UNKNOWN";
    reasons.push("low_confidence");
  } else if (cutCount === 0 && durationDrift <= 0.2) {
    classification = "MATCH";
  } else if (cutCount <= 1 && durationDrift <= 0.35) {
    classification = "MINOR_DRIFT";
    reasons.push(cutCount > 0 ? "internal_cut_detected" : "duration_drift");
  } else {
    classification = "MISMATCH";
    reasons.push(cutCount > 1 ? "multiple_internal_cuts" : "large_duration_drift");
  }

  return {
    expectedShotId: input.expectedShotId,
    observedCutCount: cutCount,
    expectedDurationMs: input.expectedDurationMs,
    observedDurationMs: input.observedDurationMs,
    classification,
    confidence: c,
    reasons,
  };
}

export function colorDistance(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 1;
  const left = new Set(a.map((x) => x.toLowerCase()));
  const right = new Set(b.map((x) => x.toLowerCase()));
  let overlap = 0;
  left.forEach((v) => {
    if (right.has(v)) overlap += 1;
  });
  return 1 - overlap / Math.max(left.size, right.size);
}

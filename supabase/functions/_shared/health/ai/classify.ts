/**
 * ONIQ HEALTH AI — document classification by rules. Phase 2 has no model, so
 * this is keyword scoring over the title and whatever text the caller could
 * supply. The person's declared kind stays authoritative; this is a hint
 * stored beside it, and the confidence says how much of a hint.
 */
import type { ClassificationResult } from "./types.ts";

export type ClassifyInput = { title: string; mime: string; sizeBytes: number; text: string | null };

export const CLASSIFY_METHOD = "rules:v1";

const KEYWORDS: Array<{ kind: string; re: RegExp }> = [
  {
    kind: "lab_report",
    re: /\b(haemoglobin|hemoglobin|hba1c|cbc|complete blood|lipid|cholesterol|creatinine|tsh|glucose|platelets?|wbc|rbc|urine|serum|reference range|lab(oratory)? report|pathology|triglycerides?|bilirubin|vitamin [bd]\d*)\b/gi,
  },
  {
    kind: "prescription",
    re: /\b(rx|prescription|prescribed|tablet|tab\.|capsule|cap\.|syrup|once daily|twice daily|thrice daily|\d+\s?mg|bd|od|tds|sos|sig)\b/gi,
  },
  {
    kind: "discharge_summary",
    re: /\b(discharge|admitted|admission|hospital course|condition at discharge|follow[- ]?up advice|inpatient)\b/gi,
  },
  {
    kind: "imaging_report",
    re: /\b(x-?ray|mri|ct scan|ct\b|ultrasound|usg|sonography|echocardiogra\w+|radiolog\w+|impression|findings|scan|mammogra\w+)\b/gi,
  },
  {
    kind: "vaccination",
    re: /\b(vaccin\w*|immuni[sz]ation|dose \d|covishield|covaxin|booster|bcg|mmr|hepatitis b vaccine|certificate of vaccination)\b/gi,
  },
  {
    kind: "invoice",
    re: /\b(invoice|bill|receipt|gst|gstin|total amount|amount due|paid|payment)\b/gi,
  },
];

function count(re: RegExp, text: string): number {
  re.lastIndex = 0;
  const m = text.match(re);
  return m ? new Set(m.map((x) => x.toLowerCase())).size : 0;
}

export function classifyDocument(input: ClassifyInput): ClassificationResult {
  const title = input.title ?? "";
  const text = input.text ?? "";
  let best: { kind: string; score: number } = { kind: "other", score: 0 };
  for (const k of KEYWORDS) {
    const score = 2 * count(k.re, title) + Math.min(6, count(k.re, text));
    if (score > best.score) best = { kind: k.kind, score };
  }
  if (best.score === 0) return { kind: "other", confidence: 0.2, method: CLASSIFY_METHOD };
  const confidence = Math.min(0.95, 0.4 + 0.1 * best.score);
  return {
    kind: best.kind,
    confidence: Math.round(confidence * 100) / 100,
    method: CLASSIFY_METHOD,
  };
}

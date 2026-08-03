// Phase 2 of the Education & Careers loop — country-aware paper generation.
//
// Pure data + pure functions. This module turns the Phase-1 registry
// (src/data/eduSystems.ts) into (a) the selection flow a non-India learner
// walks through and (b) the small, already-resolved payload the client sends
// to the `study-paper-generate` edge function so the function needs zero new
// imports and zero duplicated registry data.
//
// India is deliberately NOT modelled here: app.study.tsx's existing Board /
// ClassLevel flow and the edge function's BOARD_LABEL / BOARD_CURRICULUM path
// are proven and live, and stay byte-for-byte unchanged.
//
// Rule 2 still applies: nothing here is an authority's own syllabus prose.
// Command words, stages and subjects are ONIQ's own structural description.

import type { Country } from "@/data/appRegistry";
import { getEduSystem, type EduSystem } from "@/data/eduSystems";

/** Exactly the shape sent to study-paper-generate as `body.eduSystem`. */
export type EduSystemPayload = {
  id: string;
  authority: string;
  commandWords: string[];
  unit: "marks" | "points";
  terminator: string;
  spelling: "en-GB" | "en-US" | "en-AU" | "en-CA" | "en-IN";
};

export function eduSystemPayload(id: string): EduSystemPayload | null {
  const sys = getEduSystem(id);
  if (!sys?.paperFormat) return null;
  const f = sys.paperFormat;
  return {
    id: sys.id,
    authority: sys.authority,
    commandWords: f.commandWords,
    unit: f.unit,
    terminator: f.terminator,
    spelling: f.spelling,
  };
}

/** One-line spelling instruction threaded into the generation prompt. */
export function spellingInstruction(spelling: EduSystemPayload["spelling"]): string {
  switch (spelling) {
    case "en-US":
      return "Use American English spelling throughout (color, organize, analyze, meter).";
    case "en-AU":
      return "Use Australian English spelling throughout (colour, organise, analyse, metre).";
    case "en-CA":
      return "Use Canadian English spelling throughout (colour, organize, analyze, metre).";
    case "en-IN":
      return "Use Indian English conventions throughout (colour, organise, lakh/crore where natural).";
    case "en-GB":
    default:
      return "Use British English spelling throughout (colour, organise, analyse, metre).";
  }
}

/** Section-header unit word, e.g. "1 mark" / "3 marks" / "5 points". */
export function unitLabel(unit: "marks" | "points", n: number): string {
  if (unit === "points") return n === 1 ? "point" : "points";
  return n === 1 ? "mark" : "marks";
}

// ---------------------------------------------------------------------------
// Selection flows
// ---------------------------------------------------------------------------

export type RegionOption = {
  value: string;
  label: string;
  /** System this region resolves to. Absent => not yet supported. */
  systemId?: string;
  /** Honest message shown when the region has no verified system. */
  unsupported?: string;
};

export type EduFlow = {
  country: Country;
  /**
   * First step for most countries. `affectsContent: false` means the choice is
   * for labelling/personalisation only — the curriculum is national (AU) or
   * there is no national board and no per-state content modelled (US).
   */
  regionStep?: {
    label: string;
    help: string;
    affectsContent: boolean;
    options: RegionOption[];
  };
  /** Curriculum chooser. For AE this is the FIRST question, never "which class". */
  curriculumStep?: {
    label: string;
    options: { value: string; label: string }[];
  };
  /** Used when there is no curriculum step (single system for the country). */
  defaultSystemId?: string;
};

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois",
  "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
  "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota",
  "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming",
];

const AU_STATES = [
  "New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia",
  "Tasmania", "Australian Capital Territory", "Northern Territory",
];

const CA_PROVINCES: RegionOption[] = [
  { value: "Ontario", label: "Ontario", systemId: "ca-ontario" },
  ...["British Columbia", "Alberta", "Quebec", "Manitoba", "Saskatchewan", "Nova Scotia",
    "New Brunswick", "Newfoundland and Labrador", "Prince Edward Island"].map((p) => ({
    value: p,
    label: p,
    unsupported:
      `${p} isn't supported yet — more provinces are coming. Only Ontario's curriculum has been modelled so far, and we won't make up content for the others.`,
  })),
];

const GB_NATIONS: RegionOption[] = [
  { value: "England", label: "England", systemId: "gb-gcse" },
  { value: "Wales", label: "Wales", systemId: "gb-gcse" },
  { value: "Northern Ireland", label: "Northern Ireland", systemId: "gb-gcse" },
  {
    value: "Scotland",
    label: "Scotland",
    unsupported:
      "Scotland isn't supported yet — SQA (National 5 / Higher) licensing needs verification first. We won't generate Scottish qualification content until it is.",
  },
];

/** UAE is a curriculum chooser: the first question is always "which curriculum". */
export const AE_CURRICULA: { value: string; label: string }[] = [
  { value: "gb-gcse", label: "British (GCSE)" },
  { value: "gb-national-curriculum", label: "British (National Curriculum)" },
  { value: "us-state-standards", label: "American" },
  { value: "in-school-boards", label: "Indian" },
  { value: "ib-dp", label: "IB" },
  { value: "cambridge-igcse", label: "Cambridge" },
  { value: "uae-moe", label: "UAE MOE" },
];

const FLOWS: Record<string, EduFlow> = {
  US: {
    country: "US",
    regionStep: {
      label: "State",
      help: "For your profile only — there's no national board in the US, so this doesn't change the questions.",
      affectsContent: false,
      options: US_STATES.map((s) => ({ value: s, label: s, systemId: "us-state-standards" })),
    },
    defaultSystemId: "us-state-standards",
  },
  GB: {
    country: "GB",
    regionStep: {
      label: "Nation",
      help: "GCSE covers England, Wales and Northern Ireland.",
      affectsContent: true,
      options: GB_NATIONS,
    },
    curriculumStep: { label: "Qualification", options: [{ value: "gb-gcse", label: "GCSE" }] },
  },
  AE: {
    country: "AE",
    curriculumStep: { label: "Curriculum", options: AE_CURRICULA },
  },
  CA: {
    country: "CA",
    regionStep: {
      label: "Province",
      help: "Ontario is modelled today; other provinces are honestly marked as coming.",
      affectsContent: true,
      options: CA_PROVINCES,
    },
  },
  AU: {
    country: "AU",
    regionStep: {
      label: "State / territory",
      help: "For your profile only — the Australian Curriculum (ACARA) is national, so this doesn't change the questions.",
      affectsContent: false,
      options: AU_STATES.map((s) => ({ value: s, label: s, systemId: "au-acara" })),
    },
    defaultSystemId: "au-acara",
  },
  SG: {
    country: "SG",
    defaultSystemId: "sg-moe",
  },
};

/** null for IN — India keeps its existing Board / ClassLevel flow, untouched. */
export function eduFlowFor(country: string): EduFlow | null {
  if (country === "IN") return null;
  return FLOWS[country] ?? null;
}

export type FlowResolution =
  | { ok: true; system: EduSystem }
  | { ok: false; message: string };

/**
 * Resolve a (region, curriculum) selection to a real EduSystem, or to an
 * honest "not supported" message. Never falls back to another system's
 * content — an unsupported jurisdiction must show a message, not fiction.
 */
export function resolveFlowSystem(
  flow: EduFlow,
  sel: { region?: string; curriculumId?: string },
): FlowResolution {
  if (flow.regionStep) {
    if (!sel.region) return { ok: false, message: `Pick a ${flow.regionStep.label.toLowerCase()} to continue.` };
    const opt = flow.regionStep.options.find((o) => o.value === sel.region);
    if (!opt) return { ok: false, message: `Pick a ${flow.regionStep.label.toLowerCase()} to continue.` };
    if (opt.unsupported) return { ok: false, message: opt.unsupported };
  }
  const id = flow.curriculumStep
    ? sel.curriculumId
    : sel.curriculumId ?? flow.defaultSystemId;
  const resolved = id
    ?? (flow.regionStep?.options.find((o) => o.value === sel.region)?.systemId)
    ?? flow.defaultSystemId;
  if (!resolved) return { ok: false, message: "Pick a curriculum to continue." };
  const sys = getEduSystem(resolved);
  if (!sys?.paperFormat) {
    return { ok: false, message: "That curriculum isn't supported for paper generation yet." };
  }
  return { ok: true, system: sys };
}

/** Human label for a resolved non-India learner profile header. */
export function eduSystemLabel(id: string): string | null {
  const sys = getEduSystem(id);
  if (!sys) return null;
  const ae = AE_CURRICULA.find((c) => c.value === id);
  return ae?.label ?? sys.authority;
}

// Section order for the CV — one shared model so the live paper preview and
// the exported PDF always print the same sequence.
export type CvSectionKey = "summary" | "experience" | "qualifications" | "skills";

export const CV_SECTION_ORDER_DEFAULT: readonly CvSectionKey[] = [
  "summary",
  "experience",
  "qualifications",
  "skills",
] as const;

export const CV_SECTION_LABEL: Record<CvSectionKey, string> = {
  summary: "Summary",
  experience: "Experience",
  qualifications: "Qualifications",
  skills: "Skills",
};

/** Accepts any partial/duplicated/unknown list and returns a clean full order. */
export function normalizeSectionOrder(order?: readonly (string | undefined)[]): CvSectionKey[] {
  const seen = new Set<CvSectionKey>();
  const out: CvSectionKey[] = [];
  for (const raw of order ?? []) {
    const key = raw as CvSectionKey;
    if (CV_SECTION_ORDER_DEFAULT.includes(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  for (const key of CV_SECTION_ORDER_DEFAULT) if (!seen.has(key)) out.push(key);
  return out;
}

/** Move one entry by index; out-of-range moves are no-ops. */
export function moveSection<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

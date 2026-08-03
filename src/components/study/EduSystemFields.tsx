// Phase 2 — the "which curriculum" selection step for learners outside India.
// This ONLY replaces the Board / Class inputs on the setup + edit cards; every
// downstream screen (subjects, chapter, paper generation, results, PDF) is the
// same one India already uses.

import { getEduSystem } from "@/data/eduSystems";
import { eduFlowFor, resolveFlowSystem, type EduFlow } from "@/lib/eduPaperFormat";

export type EduSelection = {
  region: string | null;
  curriculumId: string | null;
  stage: string | null;
};

export function initialEduSelection(country: string): EduSelection {
  const flow = eduFlowFor(country);
  return {
    region: flow?.regionStep?.options[0]?.value ?? null,
    curriculumId: flow?.curriculumStep?.options[0]?.value ?? flow?.defaultSystemId ?? null,
    stage: null,
  };
}

const selectCls =
  "mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none";
const labelCls = "mt-4 block text-xs font-medium text-muted-foreground";

export function EduSystemFields({
  country,
  value,
  onChange,
}: {
  country: string;
  value: EduSelection;
  onChange: (v: EduSelection) => void;
}) {
  const flow: EduFlow | null = eduFlowFor(country);
  if (!flow) return null;

  const resolved = resolveFlowSystem(flow, {
    region: value.region ?? undefined,
    curriculumId: value.curriculumId ?? undefined,
  });
  const system = resolved.ok ? resolved.system : null;
  const stages = system?.stageModel.stages ?? [];
  const stageUnit = system?.stageModel.unitName ?? "Stage";

  return (
    <div>
      {flow.curriculumStep && (
        <>
          <label className={labelCls}>{flow.curriculumStep.label}</label>
          <select
            value={value.curriculumId ?? ""}
            onChange={(e) => onChange({ ...value, curriculumId: e.target.value, stage: null })}
            className={selectCls}
          >
            {flow.curriculumStep.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </>
      )}

      {flow.regionStep && (
        <>
          <label className={labelCls}>{flow.regionStep.label}</label>
          <select
            value={value.region ?? ""}
            onChange={(e) => onChange({ ...value, region: e.target.value, stage: null })}
            className={selectCls}
          >
            {flow.regionStep.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-muted-foreground">{flow.regionStep.help}</p>
        </>
      )}

      {!resolved.ok && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
          {resolved.message}
        </p>
      )}

      {system && (
        <>
          <label className={labelCls}>{stageUnit === "Secondary" ? "Level" : stageUnit}</label>
          <select
            value={value.stage ?? stages[0] ?? ""}
            onChange={(e) => onChange({ ...value, stage: e.target.value })}
            className={selectCls}
          >
            {stages.map((s) => (
              <option key={s} value={s}>
                {stageUnit === "Grade" || stageUnit === "Year" || stageUnit === "Class"
                  ? `${stageUnit} ${s}`
                  : s}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

/** null when the selection can't produce a real system (unsupported jurisdiction). */
export function eduSelectionResult(
  country: string,
  sel: EduSelection,
): { systemId: string; stage: string; region: string | null } | null {
  const flow = eduFlowFor(country);
  if (!flow) return null;
  const r = resolveFlowSystem(flow, {
    region: sel.region ?? undefined,
    curriculumId: sel.curriculumId ?? undefined,
  });
  if (!r.ok) return null;
  const stage = sel.stage ?? r.system.stageModel.stages[0];
  if (!stage) return null;
  return { systemId: r.system.id, stage, region: sel.region };
}

/** Subjects for a stored non-India profile, straight from the registry. */
export function eduSubjectsFor(systemId: string | null | undefined): string[] | null {
  if (!systemId) return null;
  const sys = getEduSystem(systemId);
  return sys?.subjects ?? null;
}

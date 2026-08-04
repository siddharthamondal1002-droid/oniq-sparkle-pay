// Drag-and-drop ordering for the CV's sections.
//
// Same interaction model as SkillChips: pointer events (works on touch and
// desktop, unlike HTML5 drag-and-drop in a WebView) plus arrow keys for
// keyboard users. The order here is the order the paper preview and the
// exported PDF print in.
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";

import {
  CV_SECTION_LABEL,
  moveSection,
  type CvSectionKey,
} from "@/lib/cvSections";

export function SectionOrderList({
  order,
  onChange,
  emptyKeys = [],
}: {
  order: CvSectionKey[];
  onChange: (next: CvSectionKey[]) => void;
  /** Sections with nothing in them yet — shown greyed, still reorderable. */
  emptyKeys?: CvSectionKey[];
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

  function indexAtPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    const row = el?.closest<HTMLElement>("[data-section-index]");
    if (!row) return null;
    const i = Number(row.dataset["sectionIndex"]);
    return Number.isFinite(i) ? i : null;
  }

  const end = () => {
    dragIndex.current = null;
    setDragging(null);
  };

  return (
    <ul className="mt-3 space-y-2" role="list">
      {order.map((key, i) => {
        const empty = emptyKeys.includes(key);
        return (
          <li
            key={key}
            data-section-index={i}
            tabIndex={0}
            aria-label={`${CV_SECTION_LABEL[key]}, position ${i + 1} of ${order.length}. Use arrow keys to reorder.`}
            onPointerDown={(e) => {
              dragIndex.current = i;
              setDragging(i);
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const from = dragIndex.current;
              if (from === null) return;
              const over = indexAtPoint(e.clientX, e.clientY);
              if (over === null || over === from) return;
              dragIndex.current = over;
              setDragging(over);
              onChange(moveSection(order, from, over));
            }}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                onChange(moveSection(order, i, i + (e.key === "ArrowUp" ? -1 : 1)));
              }
            }}
            className={`flex touch-none select-none items-center gap-2 rounded-xl border px-3 py-2.5 text-sm outline-none ${
              dragging === i
                ? "border-[#00D4B8]/70 bg-[#00D4B8]/10"
                : "border-white/10 bg-black/20 focus:border-[#00D4B8]/60"
            }`}
          >
            <GripVertical className="size-4 shrink-0 text-white/35" />
            <span className="w-5 shrink-0 text-[11px] text-white/35">{i + 1}</span>
            <span className={empty ? "text-white/35" : "text-white/85"}>
              {CV_SECTION_LABEL[key]}
            </span>
            {empty && <span className="ml-auto text-[11px] text-white/30">empty</span>}
          </li>
        );
      })}
    </ul>
  );
}

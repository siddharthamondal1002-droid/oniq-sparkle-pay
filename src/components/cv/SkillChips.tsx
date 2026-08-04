// Reorderable skill chips.
//
// Priority order matters on a CV — the first few skills are the ones a
// recruiter (and most ATS keyword scans) actually read. The chips are the
// source of truth for order, so dragging one rewrites declared.skills and
// the comma box, live preview and PDF all follow.
//
// Pointer events (not HTML5 drag-and-drop) so this works on touch as well
// as desktop; arrow keys do the same job for keyboard users.
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

export function SkillChips({
  skills,
  onChange,
}: {
  skills: string[];
  onChange: (next: string[]) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const dragIndex = useRef<number | null>(null);

  function indexAtPoint(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    const chip = el?.closest<HTMLElement>("[data-skill-index]");
    if (!chip) return null;
    const i = Number(chip.dataset["skillIndex"]);
    return Number.isFinite(i) ? i : null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2" role="list">
      {skills.map((s, i) => (
        <span
          key={`${s}-${i}`}
          role="listitem"
          data-skill-index={i}
          tabIndex={0}
          aria-label={`${s}, position ${i + 1} of ${skills.length}. Use arrow keys to reorder.`}
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
            onChange(move(skills, from, over));
          }}
          onPointerUp={() => {
            dragIndex.current = null;
            setDragging(null);
          }}
          onPointerCancel={() => {
            dragIndex.current = null;
            setDragging(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const to = i + (e.key === "ArrowLeft" ? -1 : 1);
            if (to < 0 || to >= skills.length) return;
            onChange(move(skills, i, to));
            // Keep focus on the chip the user is moving.
            requestAnimationFrame(() => {
              document
                .querySelector<HTMLElement>(`[data-skill-index="${to}"]`)
                ?.focus({ preventScroll: true });
            });
          }}
          className={`flex touch-none select-none items-center gap-1 rounded-full px-2.5 py-1 text-xs outline-none ring-[#00D4B8]/60 focus-visible:ring-2 ${
            dragging === i
              ? "bg-[#00D4B8]/20 text-white ring-2"
              : "bg-white/5 text-white/70 hover:bg-white/10"
          }`}
        >
          <GripVertical className="size-3 text-white/30" />
          {s}
        </span>
      ))}
    </div>
  );
}

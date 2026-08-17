/**
 * Material's responsive layout grid.
 *
 * WHAT MAKES IT MATERIAL RATHER THAN "A GRID". Material sizes a layout by the
 * WINDOW SIZE CLASS — compact, medium, expanded — not by a device guess, and
 * each class carries its own column count, margin and gutter. Four columns
 * under 600px, twelve above it, with margins that grow from 16 to 24.
 *
 * MEASURED FROM THE CONTAINER, NOT THE VIEWPORT, and today's call-grid bug is
 * exactly why. A `sm:` breakpoint asks how wide the WINDOW is; a component
 * inside a 448px column on a 1400px desktop then lays itself out as though it
 * had the whole screen. A ResizeObserver asks the only question that has ever
 * been relevant: how wide am I.
 *
 * The honest note about scope: every ONIQ user today is on a phone, in
 * `compact`. The other classes are correctness for tablets and the web, not a
 * change anybody will see this week.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { WINDOW_CLASSES, windowClassFor, type WindowClass } from "@/design/material";

/**
 * The window class of an element, watched.
 *
 * Falls back to `compact` before the first measurement, which is both the
 * commonest case and the safest: a phone layout on a desktop for one frame is
 * a flicker, a desktop layout on a phone is a broken screen.
 */
export function useWindowClass(ref: React.RefObject<HTMLElement | null>): WindowClass {
  const [cls, setCls] = React.useState<WindowClass>("compact");
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setCls(windowClassFor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cls;
}

export type LayoutGridProps = React.HTMLAttributes<HTMLDivElement> & {
  /**
   * How many of the grid's columns each child spans, per window class. A
   * child spanning 4 of 4 in compact and 6 of 12 in medium is the ordinary
   * "full width on a phone, half on a tablet" case, said in Material's terms.
   */
  span?: Partial<Record<WindowClass, number>>;
};

export const LayoutGrid = React.forwardRef<HTMLDivElement, LayoutGridProps>(function LayoutGrid(
  { span, className, style, children, ...rest },
  ref,
) {
  const inner = React.useRef<HTMLDivElement | null>(null);
  React.useImperativeHandle(ref, () => inner.current as HTMLDivElement);
  const cls = useWindowClass(inner);
  const spec = WINDOW_CLASSES.find((c) => c.name === cls) ?? WINDOW_CLASSES[0];
  const childSpan = Math.min(span?.[cls] ?? spec.columns, spec.columns);

  return (
    <div
      ref={inner}
      data-m3-window-class={cls}
      className={cn("grid", className)}
      style={{
        gridTemplateColumns: `repeat(${spec.columns}, minmax(0, 1fr))`,
        gap: `${spec.gutter}px`,
        paddingLeft: `${spec.margin}px`,
        paddingRight: `${spec.margin}px`,
        ...style,
      }}
      {...rest}
    >
      {React.Children.map(children, (child) =>
        React.isValidElement(child) ? (
          <div style={{ gridColumn: `span ${childSpan} / span ${childSpan}` }}>{child}</div>
        ) : (
          child
        ),
      )}
    </div>
  );
});

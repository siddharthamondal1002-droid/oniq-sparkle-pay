/**
 * "OPEN →" — the one place that knows how to reach a result screen.
 *
 * WHY A COMPONENT FOR A LINK. Four screens point at /app/made/$kind/$id —
 * Image, Music, Voice and My Creations — and a route path spelled out four
 * times is four places to miss when it changes. It is the same argument that
 * made the result screen ONE route with two layouts rather than three files.
 *
 * IT IS A FOOTER LINK, NOT A WHOLE-CARD LINK, and that is deliberate. The
 * cards it sits under contain real controls — an <audio controls> a person
 * presses play on — and an interactive control inside a link is both an
 * accessibility violation and a behaviour bug: the tap that should start the
 * track navigates away instead. So the card stays a card and only this is
 * clickable.
 */
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/** The kinds the result route serves. Mirrors KINDS in app.made.$kind.$id. */
export type MadeKind = "image" | "music" | "voice";

export function OniqMadeLink({
  kind,
  id,
  label = "Open",
  className,
  testId,
}: {
  kind: MadeKind;
  id: string;
  label?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <Link
      to="/app/made/$kind/$id"
      params={{ kind, id }}
      data-testid={testId}
      className={cn(
        "press mt-2 inline-flex text-[12px] font-semibold normal-case tracking-normal text-world",
        className,
      )}
    >
      {label} →
    </Link>
  );
}

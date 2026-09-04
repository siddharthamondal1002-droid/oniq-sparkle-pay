/**
 * THE SIX CARDS AND THE AI ROW — the middle of Create.
 *
 * Extracted from the sheet when Create became a full screen (owner directive
 * 2026-09-04f) so the markup lives ONCE. Two copies of a six-card grid is how
 * a radius, a tint or a "Not yet" badge ends up different on two surfaces that
 * are supposed to be the same thing, which is the drift OniqIconBadge was
 * created to stop in the first place.
 *
 * Every live card is a real destination from src/lib/create/capabilities.ts;
 * a card that is not live says so and goes nowhere. No provider, no model and
 * no price appears here.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Clapperboard,
  FileText,
  ImageIcon,
  Mic,
  Music4,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  CREATE_AI,
  CREATE_CLIP,
  CREATE_GRID,
  type CreateCapabilityId,
} from "@/lib/create/capabilities";
import { cn } from "@/lib/utils";
import { OniqAIOrb } from "./OniqAIOrb";
import { OniqIconBadge } from "./OniqIconBadge";

/**
 * One glyph per grid card, owner reference 2026-09-04: a plain vector icon
 * on its own colour, not the emoji-in-a-square the sheet drew before. Kept
 * here rather than in capabilities.ts, which stays framework-agnostic data.
 */
const GRID_ICON: Partial<Record<CreateCapabilityId, LucideIcon>> = {
  image: ImageIcon,
  video: Clapperboard,
  character: UserRound,
  voice: Mic,
  music: Music4,
  document: FileText,
};

export function OniqCreateGrid({ className }: { className?: string }) {
  const navigate = useNavigate();
  const go = (to?: string, search?: Record<string, string>) => {
    if (!to) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: to as any, search: search as any });
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2">
        {CREATE_GRID.map((c) => {
          const live = c.status === "live";
          const Icon = GRID_ICON[c.id];
          return (
            <button
              key={c.id}
              type="button"
              data-testid={`create-${c.id}`}
              aria-disabled={!live}
              onClick={() => (live ? go(c.to, c.search) : undefined)}
              className={cn(
                "flex min-h-[104px] flex-col items-start gap-2.5 rounded-2xl oniq-surface p-3.5 text-start",
                live ? "press" : "cursor-default opacity-70",
              )}
            >
              {/*
                The SAME badge the world tiles and Explore rows draw — one
                component, so the four surfaces cannot drift in radius, size
                or tint again. A card that is not live drops to the neutral
                hue rather than keeping its colour at reduced opacity: a
                faded pink still reads as "the pink one", which is exactly
                the affordance a dead card should not have.
              */}
              <OniqIconBadge tint={live ? (c.tint ?? "slate") : "slate"} size="md">
                {Icon ? <Icon /> : <span aria-hidden="true">{c.emoji}</span>}
              </OniqIconBadge>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 font-display text-[14px] normal-case tracking-normal text-foreground">
                  {c.label}
                  {!live ? (
                    <span className="whitespace-nowrap rounded-full border border-border px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground">
                      Not yet
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] font-normal normal-case leading-snug tracking-normal text-muted-foreground">
                  {c.hint}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        data-testid="create-ai"
        onClick={() => go(CREATE_AI.to)}
        className="press mt-3 flex w-full items-center gap-3 rounded-2xl bg-world p-3 text-start text-white world-glow"
      >
        <OniqAIOrb size="md" />
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[14px]">{CREATE_AI.label}</span>
          <span className="block text-[12px] font-normal normal-case tracking-normal text-white/85">
            {CREATE_AI.hint}
          </span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0 rtl:-scale-x-100" />
      </button>

      <button
        type="button"
        data-testid="create-clip"
        onClick={() => go(CREATE_CLIP.to)}
        // normal-case against the app-wide `button { text-transform: uppercase }`
        // rule, which was rendering this "POST A CLIP". Every other label on
        // this screen is sentence case and so is every label in the reference.
        className="press mt-3 inline-flex items-center gap-2 text-[12px] font-semibold normal-case tracking-normal text-world"
      >
        <span aria-hidden="true">{CREATE_CLIP.emoji}</span> {CREATE_CLIP.label}
        <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
      </button>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Cards marked "Not yet" are not available in ONIQ today and open nothing.
      </p>
    </div>
  );
}

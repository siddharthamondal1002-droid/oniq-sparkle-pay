import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Images,
  Camera,
  MapPin,
  User,
  FileText,
  Headphones,
  BarChart3,
  CalendarDays,
  Sparkles,
  Music2,
  Timer,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { ATTACH_FLAGS } from "@/lib/flags";

/* ------------------------------------------------------------------ *
 * 1. Surfaces
 * ------------------------------------------------------------------ */

export type AttachmentSurface = "chat" | "moment" | "reel";

/** Anything the sheet needs to know about runtime capability / flags. */
export interface AttachmentContext {
  isNative: boolean; // Capacitor shell vs plain web
  flags: Record<string, boolean>; // remote/feature flags
  permissions?: Partial<Record<"camera" | "mic" | "location" | "contacts", boolean>>;
}

/** Default context for ONIQ call sites. */
export function useAttachmentContext(): AttachmentContext {
  return useMemo(
    () => ({ isNative: Capacitor.isNativePlatform(), flags: ATTACH_FLAGS }),
    [],
  );
}

/* ------------------------------------------------------------------ *
 * 2. The single source of truth — add an option here, it appears
 *    everywhere it declares a surface. Nothing else to touch.
 *    Options for features not yet built in ONIQ carry a flag that is
 *    currently false in ATTACH_FLAGS — flip the flag when the feature
 *    lands and the tile appears everywhere at once.
 * ------------------------------------------------------------------ */

export interface AttachmentOption {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Tailwind classes for the tile chip. Keep one accent per option. */
  tint: string;
  surfaces: AttachmentSurface[];
  /** Optional file picker config — omit for options that open a screen. */
  accept?: string;
  multiple?: boolean;
  /** Feature flag key. If present and falsy in context.flags, hidden. */
  flag?: string;
  /** Native-only (Capacitor plugin backed). */
  nativeOnly?: boolean;
  /** Order weight, lower first. Defaults to array order. */
  weight?: number;
}

export const ATTACHMENT_OPTIONS: AttachmentOption[] = [
  {
    id: "gallery",
    label: "Gallery",
    icon: Images,
    tint: "bg-blue-500/10 text-blue-500",
    surfaces: ["chat", "moment", "reel"],
    accept: "image/*,video/*",
    multiple: true,
  },
  {
    id: "camera",
    label: "Camera",
    icon: Camera,
    tint: "bg-pink-500/10 text-pink-500",
    surfaces: ["chat", "moment", "reel"],
    accept: "image/*",
  },
  {
    id: "location",
    label: "Location",
    icon: MapPin,
    tint: "bg-emerald-500/10 text-emerald-500",
    surfaces: ["chat"],
  },
  {
    id: "contact",
    label: "Contact",
    icon: User,
    tint: "bg-sky-500/10 text-sky-500",
    surfaces: ["chat"],
    nativeOnly: true,
    flag: "contactShare",
  },
  {
    id: "document",
    label: "Document",
    icon: FileText,
    tint: "bg-violet-500/10 text-violet-500",
    surfaces: ["chat"],
    accept:
      "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.*,text/plain,application/zip",
    multiple: true,
  },
  {
    id: "audio",
    label: "Audio",
    icon: Headphones,
    tint: "bg-orange-500/10 text-orange-500",
    surfaces: ["chat", "moment"],
    accept: "audio/*",
  },
  {
    id: "poll",
    label: "Poll",
    icon: BarChart3,
    tint: "bg-amber-500/10 text-amber-500",
    surfaces: ["chat", "moment"],
    flag: "polls",
  },
  {
    id: "event",
    label: "Event",
    icon: CalendarDays,
    tint: "bg-rose-500/10 text-rose-500",
    surfaces: ["chat", "moment"],
    flag: "events",
  },
  {
    id: "ai-image",
    label: "AI images",
    icon: Sparkles,
    tint: "bg-indigo-500/10 text-indigo-500",
    surfaces: ["chat", "moment", "reel"],
    flag: "aiImages",
  },
  // Reel-native creation tools
  {
    id: "audio-track",
    label: "Add audio",
    icon: Music2,
    tint: "bg-fuchsia-500/10 text-fuchsia-500",
    surfaces: ["reel"],
    flag: "reelTools",
  },
  {
    id: "duration",
    label: "Duration",
    icon: Timer,
    tint: "bg-cyan-500/10 text-cyan-600",
    surfaces: ["reel"],
    flag: "reelTools",
  },
  {
    id: "text-overlay",
    label: "Text",
    icon: Type,
    tint: "bg-lime-500/10 text-lime-600",
    surfaces: ["moment", "reel"],
    flag: "textOverlay",
  },
];

/* ------------------------------------------------------------------ *
 * 3. The filter — one hook, every surface
 * ------------------------------------------------------------------ */

export function useAttachmentOptions(
  surface: AttachmentSurface,
  ctx: AttachmentContext,
  /** Hide specific ids at the call site without editing the registry. */
  exclude: string[] = [],
) {
  const excludeKey = exclude.join(",");
  return useMemo(
    () =>
      ATTACHMENT_OPTIONS.filter((o) => {
        if (!o.surfaces.includes(surface)) return false;
        if (exclude.includes(o.id)) return false;
        if (o.nativeOnly && !ctx.isNative) return false;
        if (o.flag && !ctx.flags[o.flag]) return false;
        return true;
      }).sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, ctx.isNative, ctx.flags, excludeKey],
  );
}

/* ------------------------------------------------------------------ *
 * 4. Sheet
 * ------------------------------------------------------------------ */

export interface AttachmentSheetProps {
  open: boolean;
  surface: AttachmentSurface;
  context: AttachmentContext;
  exclude?: string[];
  /** Override the file-picker accept per call site (e.g. reels: video only). */
  acceptOverride?: Partial<Record<string, string>>;
  onClose: () => void;
  /** Fires for options without an `accept` config. */
  onSelect: (option: AttachmentOption) => void;
  /** Fires for file-backed options once the user picks files. */
  onFiles: (option: AttachmentOption, files: File[]) => void;
}

export function AttachmentSheet({
  open,
  surface,
  context,
  exclude,
  acceptOverride,
  onClose,
  onSelect,
  onFiles,
}: AttachmentSheetProps) {
  const options = useAttachmentOptions(surface, context, exclude);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<AttachmentOption | null>(null);
  const firstTileRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    firstTileRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleTile = useCallback(
    (option: AttachmentOption) => {
      if (option.accept) {
        pendingRef.current = option;
        const input = inputRef.current;
        if (!input) return;
        input.value = "";
        input.accept = acceptOverride?.[option.id] ?? option.accept;
        input.multiple = Boolean(option.multiple);
        if (option.id === "camera" && context.isNative === false) {
          input.setAttribute("capture", "environment");
        } else {
          input.removeAttribute("capture");
        }
        input.click();
        return;
      }
      onSelect(option);
      onClose();
    },
    [context.isNative, acceptOverride, onSelect, onClose],
  );

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Attach to ${surface}`}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-md rounded-t-3xl border-t border-border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted" />

        <div className="grid grid-cols-4 gap-x-2 gap-y-5">
          {options.map((option, i) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                ref={i === 0 ? firstTileRef : undefined}
                type="button"
                data-testid={`attach-${option.id}`}
                onClick={() => handleTile(option)}
                className="flex flex-col items-center gap-2 rounded-xl p-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl ${option.tint} transition-transform active:scale-90`}
                >
                  <Icon className="h-6 w-6" strokeWidth={1.75} />
                </span>
                <span className="text-xs text-muted-foreground">{option.label}</span>
              </button>
            );
          })}
        </div>

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const option = pendingRef.current;
            const files = Array.from(e.target.files ?? []);
            pendingRef.current = null;
            if (option && files.length) onFiles(option, files);
            onClose();
          }}
        />
      </div>
    </>
  );
}

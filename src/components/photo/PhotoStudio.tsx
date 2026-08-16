import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { X, Check, RotateCw, Loader2, SlidersHorizontal, Wand2, RefreshCcw } from "lucide-react";
import { FACE_FX, FACE_LENSES, faceGeometryOf } from "@/lib/faceFx";

/**
 * PhotoStudio — the single edit surface every photo passes through before
 * upload (chat attachments, moments composer/edit, profile photo).
 *
 * Presets + adjustments are CSS filter strings; the live preview is a plain
 * <img> with a GPU filter (no canvas until export). Export re-renders on a
 * canvas capped at 2048px and re-encodes (WebP q0.85 → JPEG fallback), which
 * strips ALL metadata including EXIF/GPS by construction. The chosen filter
 * is never persisted or attached to the message/post row.
 */

type Preset = {
  id: string;
  label: string;
  /** CSS filter for intensity t ∈ [0,1] */
  css: (t: number) => string;
  grain?: boolean;
  vignette?: boolean;
};

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const f = (n: number) => Math.round(n * 1000) / 1000;

export const PRESETS: Preset[] = [
  { id: "original", label: "Original", css: () => "" },
  {
    id: "clarity",
    label: "Clarity",
    css: (t) => `contrast(${f(lerp(1, 1.18, t))}) saturate(${f(lerp(1, 1.12, t))})`,
  },
  {
    id: "warm",
    label: "Warm",
    css: (t) =>
      `sepia(${f(0.32 * t)}) saturate(${f(lerp(1, 1.25, t))}) brightness(${f(lerp(1, 1.05, t))})`,
  },
  {
    id: "cool",
    label: "Cool",
    css: (t) =>
      `hue-rotate(${f(12 * t)}deg) saturate(${f(lerp(1, 1.08, t))}) brightness(${f(lerp(1, 1.03, t))}) contrast(${f(lerp(1, 1.04, t))})`,
  },
  {
    id: "vivid",
    label: "Vivid",
    css: (t) => `saturate(${f(lerp(1, 1.55, t))}) contrast(${f(lerp(1, 1.12, t))})`,
  },
  {
    id: "fade",
    label: "Fade",
    css: (t) =>
      `contrast(${f(lerp(1, 0.78, t))}) brightness(${f(lerp(1, 1.1, t))}) saturate(${f(lerp(1, 0.75, t))})`,
  },
  { id: "noir", label: "Noir", css: (t) => `grayscale(${f(t)}) contrast(${f(lerp(1, 1.28, t))})` },
  { id: "sepia", label: "Sepia", css: (t) => `sepia(${f(t)})` },
  {
    id: "retro",
    label: "Retro",
    css: (t) =>
      `sepia(${f(0.5 * t)}) contrast(${f(lerp(1, 1.15, t))}) saturate(${f(lerp(1, 0.82, t))}) hue-rotate(${f(-8 * t)}deg)`,
    vignette: true,
  },
  {
    id: "dusk",
    label: "Dusk",
    css: (t) =>
      `brightness(${f(lerp(1, 0.86, t))}) hue-rotate(${f(-18 * t)}deg) saturate(${f(lerp(1, 1.18, t))})`,
    vignette: true,
  },
  {
    id: "neon",
    label: "Neon",
    css: (t) =>
      `saturate(${f(lerp(1, 1.85, t))}) contrast(${f(lerp(1, 1.2, t))}) hue-rotate(${f(8 * t)}deg)`,
  },
  {
    id: "monocontrast",
    label: "Mono+",
    css: (t) =>
      `grayscale(${f(t)}) contrast(${f(lerp(1, 1.55, t))}) brightness(${f(lerp(1, 1.04, t))})`,
  },
  {
    id: "soft",
    label: "Soft",
    css: (t) =>
      `blur(${f(1.1 * t)}px) brightness(${f(lerp(1, 1.06, t))}) saturate(${f(lerp(1, 1.05, t))})`,
  },
  {
    id: "grain",
    label: "Film Grain",
    css: (t) => `contrast(${f(lerp(1, 1.1, t))}) saturate(${f(lerp(1, 0.92, t))})`,
    grain: true,
  },
  // ---- the FUNNY rack (owner directive: "all sorts of ai funny filters") ----
  // Every one is a pure CSS filter chain, so preview stays GPU-cheap and the
  // existing ctx.filter export path renders them without new code.
  {
    id: "alien",
    label: "Alien 👽",
    css: (t) =>
      `hue-rotate(${f(95 * t)}deg) saturate(${f(lerp(1, 1.7, t))}) contrast(${f(lerp(1, 1.12, t))})`,
  },
  {
    id: "thermal",
    label: "Thermal 🔥",
    css: (t) =>
      `invert(${f(0.85 * t)}) hue-rotate(${f(160 * t)}deg) saturate(${f(lerp(1, 2.4, t))})`,
  },
  {
    id: "ghost",
    label: "Ghost 👻",
    css: (t) => `invert(${f(t)}) brightness(${f(lerp(1, 1.15, t))}) blur(${f(0.6 * t)}px)`,
  },
  {
    id: "vapor",
    label: "Vapor 🌴",
    css: (t) =>
      `hue-rotate(${f(-45 * t)}deg) saturate(${f(lerp(1, 1.9, t))}) brightness(${f(lerp(1, 1.08, t))}) contrast(${f(lerp(1, 0.92, t))})`,
  },
  {
    id: "cyber",
    label: "Cyber 🤖",
    css: (t) =>
      `hue-rotate(${f(200 * t)}deg) saturate(${f(lerp(1, 2.1, t))}) contrast(${f(lerp(1, 1.35, t))}) brightness(${f(lerp(1, 0.95, t))})`,
  },
  {
    id: "toasty",
    label: "Toasty 🍞",
    css: (t) =>
      `sepia(${f(0.9 * t)}) saturate(${f(lerp(1, 2.2, t))}) hue-rotate(${f(-25 * t)}deg) contrast(${f(lerp(1, 1.18, t))})`,
  },
];

type Adjust = {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  blur: number;
  sharpen: number;
};
const ADJUST_DEFAULT: Adjust = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  warmth: 0,
  blur: 0,
  sharpen: 0,
};
type CropAspect = "free" | "1:1" | "4:5" | "9:16";
const CROP_RATIOS: Record<Exclude<CropAspect, "free">, number> = {
  "1:1": 1,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
};

function adjustCss(a: Adjust, blurScale = 1): string {
  const parts: string[] = [];
  if (a.brightness !== 100) parts.push(`brightness(${f(a.brightness / 100)})`);
  if (a.contrast !== 100) parts.push(`contrast(${f(a.contrast / 100)})`);
  if (a.saturation !== 100) parts.push(`saturate(${f(a.saturation / 100)})`);
  if (a.warmth !== 0) parts.push(`sepia(${f(a.warmth / 200)})`);
  if (a.blur !== 0) parts.push(`blur(${f((a.blur / 10) * blurScale)}px)`);
  // a.sharpen intentionally absent: unsharp mask runs at export only
  // (no CSS primitive; preview stays 60fps).
  return parts.join(" ");
}

// One shared 64px noise tile, generated lazily.
let noiseTile: HTMLCanvasElement | null = null;
function getNoiseTile(): HTMLCanvasElement {
  if (noiseTile) return noiseTile;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 100 + Math.floor(Math.random() * 100);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}

export function PhotoStudio({
  file,
  onCancel,
  onDone,
}: {
  file: File;
  onCancel: () => void;
  onDone: (edited: File) => void;
}) {
  const [srcUrl] = useState(() => URL.createObjectURL(file));
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"filters" | "adjust">("filters");
  const [presetId, setPresetId] = useState("original");
  const [intensity, setIntensity] = useState(100);
  const [adjust, setAdjust] = useState<Adjust>(ADJUST_DEFAULT);
  const [rotate, setRotate] = useState(0);
  const [crop, setCrop] = useState<CropAspect>("free");
  // Free-drag crop: pan the image inside the crop window (0..1, 0.5 = center).
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const onDragStart = (cx: number, cy: number) => {
    dragRef.current = { startX: cx, startY: cy, panX: pan.x, panY: pan.y };
  };
  const onDragMove = (cx: number, cy: number, el: HTMLElement) => {
    const d = dragRef.current;
    if (!d) return;
    const r = el.getBoundingClientRect();
    setPan({
      x: Math.min(1, Math.max(0, d.panX - (cx - d.startX) / Math.max(r.width, 1))),
      y: Math.min(1, Math.max(0, d.panY - (cy - d.startY) / Math.max(r.height, 1))),
    });
  };
  const [exporting, setExporting] = useState(false);
  // Face lenses: the chosen id, the baked result, and whether it is baking.
  const [lensId, setLensId] = useState<string | null>(null);
  const [lensUrl, setLensUrl] = useState<string | null>(null);
  const [lensBusy, setLensBusy] = useState(false);
  const lensBlobRef = useRef<Blob | null>(null);
  const lensUrlRef = useRef<string | null>(null);

  /**
   * Take ownership of a new lens preview URL and free the one it replaces.
   *
   * Revoking in the effect's CLEANUP is the obvious version and it is wrong:
   * cleanup runs the moment the lens changes, while the old URL is still the
   * one in the <img> — the preview would go to a broken image for as long as
   * the new lens takes to bake, which on a large photo is the whole time
   * anybody is looking. Freeing on REPLACEMENT means the old bitmap survives
   * exactly until something else is ready to be shown.
   */
  const swapLensUrl = useCallback((next: string | null) => {
    if (lensUrlRef.current) URL.revokeObjectURL(lensUrlRef.current);
    lensUrlRef.current = next;
    return next;
  }, []);
  // The last one still has to be freed, and nothing replaces it.
  useEffect(
    () => () => {
      swapLensUrl(null);
    },
    [swapLensUrl],
  );

  // rAF-coalesced filter string so slider drags never outpace the frame rate.
  const [filterStr, setFilterStr] = useState("");
  const rafPending = useRef(false);
  const latest = useRef({ presetId, intensity, adjust });
  latest.current = { presetId, intensity, adjust };
  useEffect(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      const { presetId: p, intensity: i, adjust: a } = latest.current;
      const preset = PRESETS.find((x) => x.id === p) ?? PRESETS[0];
      setFilterStr([preset.css(i / 100), adjustCss(a)].filter(Boolean).join(" "));
    });
  }, [presetId, intensity, adjust]);

  const preset = PRESETS.find((x) => x.id === presetId) ?? PRESETS[0];

  // 96px thumbnail generated ONCE for the whole strip (CSS filters do the rest).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const bmp = await createImageBitmap(file);
        const scale = 96 / Math.max(bmp.width, bmp.height);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(bmp.width * scale));
        c.height = Math.max(1, Math.round(bmp.height * scale));
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        if (!cancelled) setThumbUrl(c.toDataURL("image/jpeg", 0.7));
      } catch {
        /* strip just shows unfiltered src */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  useEffect(() => () => URL.revokeObjectURL(srcUrl), [srcUrl]);

  /**
   * FACE LENSES ARE BAKED INTO A NEW SOURCE IMAGE, not layered over the
   * preview.
   *
   * The obvious build — draw the lens on top of the <img> in a positioned
   * canvas — has to map every landmark through the rotate, the crop aspect
   * and the drag-pan to know where the ears go, and then do the same
   * arithmetic a second time, differently, in the export path. Two
   * implementations of one fiddly transform is a guaranteed drift, and the
   * failure is subtle: ears that sit right in the preview and wrong in the
   * file that gets sent.
   *
   * Compositing the lens onto the ORIGINAL bitmap first removes the problem
   * rather than solving it twice. Landmarks are already in original-image
   * coordinates, so nothing has to be mapped at all, and every stage after
   * this one — filter, rotate, crop, pan, export — runs on the lensed image
   * completely unchanged and unaware.
   *
   * Cost is one detection per photo, not one per frame: the effect is keyed
   * on the lens and the file, so dragging the intensity slider re-renders
   * nothing here.
   */
  useEffect(() => {
    if (!lensId) {
      setLensUrl(swapLensUrl(null));
      lensBlobRef.current = null;
      return;
    }
    let cancelled = false;
    setLensBusy(true);
    (async () => {
      try {
        const bmp = await createImageBitmap(file);
        const g = await faceGeometryOf(bmp, bmp.width, bmp.height);
        if (!g) {
          bmp.close();
          if (!cancelled) {
            setLensId(null);
            toast.error("No face found in this photo");
          }
          return;
        }
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const cx = c.getContext("2d");
        if (!cx) throw new Error("no canvas");
        cx.drawImage(bmp, 0, 0);
        bmp.close();
        // A still has no clock, so the animated lenses are frozen at a chosen
        // moment rather than at 0 — hearts at t=0 are at the bottom of their
        // beat and tears at t=0 have not fallen yet, which reads as the lens
        // having failed.
        FACE_FX[lensId]?.(cx, g, c, 400);
        const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.92));
        if (cancelled || !blob) return;
        lensBlobRef.current = blob;
        setLensUrl(swapLensUrl(URL.createObjectURL(blob)));
      } catch {
        if (!cancelled) {
          setLensId(null);
          toast.error("Could not apply that lens");
        }
      } finally {
        if (!cancelled) setLensBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lensId, file, swapLensUrl]);

  async function exportImage() {
    setExporting(true);
    try {
      // The lensed copy when there is one — it is the same picture with the
      // art already burned in, so everything downstream is untouched.
      const bmp = await createImageBitmap(lensBlobRef.current ?? file);
      const rot = ((rotate % 360) + 360) % 360;
      const rotated = rot === 90 || rot === 270;
      let w = rotated ? bmp.height : bmp.width;
      let h = rotated ? bmp.width : bmp.height;

      // crop to the chosen aspect, positioned by the drag-pan offsets
      let cw = w;
      let ch = h;
      if (crop !== "free") {
        const r = CROP_RATIOS[crop];
        if (cw / ch > r) cw = Math.round(ch * r);
        else ch = Math.round(cw / r);
      }

      const scale = Math.min(1, 2048 / Math.max(cw, ch));
      const outW = Math.max(1, Math.round(cw * scale));
      const outH = Math.max(1, Math.round(ch * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");

      // blur radius must scale with resolution to match the preview look
      const previewEdge = 360;
      const blurScale = Math.max(outW, outH) / previewEdge;
      ctx.filter =
        [preset.css(intensity / 100), adjustCss(adjust, blurScale)].filter(Boolean).join(" ") ||
        "none";

      ctx.save();
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((rot * Math.PI) / 180);
      const drawW = rotated ? outH * (w / cw) : outW * (w / cw);
      const drawH = rotated ? outW * (h / ch) : outH * (h / ch);
      // Pan shifts which part of the over-sized draw lands in the window
      // (0.5 = centered, matching the objectPosition preview).
      const spanW = rotated ? outH : outW;
      const spanH = rotated ? outW : outH;
      const offX = (pan.x - 0.5) * (drawW - spanW);
      const offY = (pan.y - 0.5) * (drawH - spanH);
      const dx = rotated ? -offY : -offX;
      const dy = rotated ? -offX : -offY;
      ctx.drawImage(bmp, -drawW / 2 + dx, -drawH / 2 + dy, drawW, drawH);
      ctx.restore();
      bmp.close();
      ctx.filter = "none";

      // Unsharp mask (export-only): out = base + k * (base - blurred).
      if (adjust.sharpen > 0) {
        const k = (adjust.sharpen / 100) * 0.8;
        const blurCanvas = document.createElement("canvas");
        blurCanvas.width = outW;
        blurCanvas.height = outH;
        const bctx = blurCanvas.getContext("2d");
        if (bctx) {
          bctx.filter = `blur(${Math.max(1.2, Math.round(Math.max(outW, outH) / 800))}px)`;
          bctx.drawImage(canvas, 0, 0);
          const base = ctx.getImageData(0, 0, outW, outH);
          const blur = bctx.getImageData(0, 0, outW, outH);
          const bd = base.data;
          const ld = blur.data;
          for (let i = 0; i < bd.length; i += 4) {
            bd[i] = bd[i] + k * (bd[i] - ld[i]);
            bd[i + 1] = bd[i + 1] + k * (bd[i + 1] - ld[i + 1]);
            bd[i + 2] = bd[i + 2] + k * (bd[i + 2] - ld[i + 2]);
          }
          ctx.putImageData(base, 0, 0);
        }
      }

      const t = intensity / 100;
      if (preset.grain && t > 0) {
        ctx.save();
        ctx.globalAlpha = 0.1 * t;
        ctx.globalCompositeOperation = "overlay";
        const tile = getNoiseTile();
        const pattern = ctx.createPattern(tile, "repeat");
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, outW, outH);
        }
        ctx.restore();
      }
      if (preset.vignette && t > 0) {
        const g = ctx.createRadialGradient(
          outW / 2,
          outH / 2,
          Math.min(outW, outH) * 0.45,
          outW / 2,
          outH / 2,
          Math.max(outW, outH) * 0.72,
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${0.28 * t})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, outW, outH);
      }

      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b && b.type === "image/webp") return resolve(b);
            // WebP unsupported → JPEG fallback
            canvas.toBlob(
              (j) => (j ? resolve(j) : reject(new Error("encode failed"))),
              "image/jpeg",
              0.85,
            );
          },
          "image/webp",
          0.85,
        );
      });
      const ext = blob.type === "image/webp" ? "webp" : "jpg";
      onDone(new File([blob], `photo.${ext}`, { type: blob.type }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "couldn't process the photo");
    } finally {
      setExporting(false);
    }
  }

  const cropStyle = crop === "free" ? undefined : { aspectRatio: CROP_RATIOS[crop] };
  const dirty =
    presetId !== "original" ||
    rotate !== 0 ||
    crop !== "free" ||
    JSON.stringify(adjust) !== JSON.stringify(ADJUST_DEFAULT);

  return (
    // stopPropagation: hosts render this inside click-to-dismiss overlays
    // (AvatarEditorSheet, EditPostSheet) — without it every tap in the studio
    // bubbles to the overlay's onClose and unmounts the studio mid-edit.
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-black"
      onClick={(e) => e.stopPropagation()}
    >
      {/* top bar */}
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          onClick={onCancel}
          aria-label="Cancel"
          className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setPresetId("original");
              setIntensity(100);
              setAdjust(ADJUST_DEFAULT);
              setRotate(0);
              setCrop("free");
              setPan({ x: 0.5, y: 0.5 });
            }}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-white"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> reset
          </button>
          <button
            onClick={exportImage}
            disabled={exporting}
            data-testid="photostudio-done"
            className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}{" "}
            done
          </button>
        </div>
      </div>

      {/* preview */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2">
        <div
          className="relative max-h-full touch-none overflow-hidden rounded-xl"
          style={cropStyle}
          onTouchStart={(e) =>
            crop !== "free" && onDragStart(e.touches[0].clientX, e.touches[0].clientY)
          }
          onTouchMove={(e) =>
            crop !== "free" &&
            onDragMove(e.touches[0].clientX, e.touches[0].clientY, e.currentTarget)
          }
          onTouchEnd={() => (dragRef.current = null)}
          onMouseDown={(e) => crop !== "free" && onDragStart(e.clientX, e.clientY)}
          onMouseMove={(e) =>
            crop !== "free" && e.buttons === 1 && onDragMove(e.clientX, e.clientY, e.currentTarget)
          }
          onMouseUp={() => (dragRef.current = null)}
        >
          <img
            src={lensUrl ?? srcUrl}
            alt=""
            className="max-h-[52vh] w-auto max-w-full select-none object-cover"
            style={{
              filter: filterStr || undefined,
              transform: rotate ? `rotate(${rotate}deg)` : undefined,
              ...(crop !== "free"
                ? {
                    height: "100%",
                    width: "100%",
                    objectFit: "cover" as const,
                    objectPosition: `${pan.x * 100}% ${pan.y * 100}%`,
                  }
                : {}),
            }}
            draggable={false}
          />
          {preset.vignette && intensity > 0 && (
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(circle, transparent 55%, rgba(0,0,0,${0.28 * (intensity / 100)}) 100%)`,
              }}
            />
          )}
          {preset.grain && intensity > 0 && (
            <div
              className="pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay"
              style={{ backgroundImage: `url(${getNoiseTile().toDataURL()})` }}
            />
          )}
        </div>
      </div>

      {/* controls */}
      <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {tab === "filters" ? (
          <>
            {/* Lenses first, and on their own row: they are a different KIND
                of edit from the colour presets — one changes the picture's
                mood, the other puts ears on somebody — and mixing them into
                one strip made both harder to find. They also compose: a lens
                and a colour filter can be on at once. */}
            <div className="flex items-center gap-2 overflow-x-auto px-3 pt-2 scrollbar-none">
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-white/40">
                lens
              </span>
              <button
                onClick={() => setLensId(null)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                  lensId === null
                    ? "border-primary bg-primary/15 font-semibold text-primary"
                    : "border-white/15 text-white/70"
                }`}
              >
                None
              </button>
              {FACE_LENSES.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLensId(l.id)}
                  disabled={lensBusy}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs disabled:opacity-50 ${
                    lensId === l.id
                      ? "border-primary bg-primary/15 font-semibold text-primary"
                      : "border-white/15 text-white/70"
                  }`}
                >
                  {l.label}
                </button>
              ))}
              {lensBusy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white/60" />}
            </div>
            <div className="flex gap-2 overflow-x-auto px-3 py-2 scrollbar-none">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPresetId(p.id);
                    if (p.id !== presetId) setIntensity(100);
                  }}
                  className="flex shrink-0 flex-col items-center gap-1"
                >
                  <span
                    className={`block h-16 w-16 overflow-hidden rounded-xl border-2 ${presetId === p.id ? "border-primary" : "border-transparent"}`}
                  >
                    <img
                      src={thumbUrl ?? srcUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      style={{ filter: p.css(1) || undefined }}
                      draggable={false}
                    />
                  </span>
                  <span
                    className={`text-[10px] ${presetId === p.id ? "font-semibold text-primary" : "text-white/70"}`}
                  >
                    {p.label}
                  </span>
                </button>
              ))}
            </div>
            {presetId !== "original" && (
              <div className="flex items-center gap-3 px-4 pb-1">
                <span className="w-14 text-[11px] text-white/70">intensity</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="flex-1 accent-[hsl(var(--primary))]"
                  aria-label="Filter intensity"
                />
                <span className="w-8 text-right text-[11px] text-white/70">{intensity}%</span>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-2 px-4 py-2">
            {(
              [
                ["brightness", 50, 150],
                ["contrast", 50, 150],
                ["saturation", 0, 200],
                ["warmth", 0, 100],
                ["blur", 0, 40],
                ["sharpen", 0, 100],
              ] as const
            ).map(([key, min, max]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-16 text-[11px] capitalize text-white/70">{key}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={adjust[key]}
                  onChange={(e) => setAdjust((a) => ({ ...a, [key]: Number(e.target.value) }))}
                  className="flex-1 accent-[hsl(var(--primary))]"
                  aria-label={key}
                />
              </div>
            ))}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={() => setRotate((r) => (r + 90) % 360)}
                className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white"
              >
                <RotateCw className="h-3.5 w-3.5" /> rotate
              </button>
              <div className="flex gap-1.5">
                {(["free", "1:1", "4:5", "9:16"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCrop(c);
                      setPan({ x: 0.5, y: 0.5 });
                    }}
                    className={`rounded-full px-2.5 py-1.5 text-[11px] font-medium ${crop === c ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/80"}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* tabs */}
        <div className="mx-3 mt-1 grid grid-cols-2 rounded-full bg-white/10 p-1 text-xs font-semibold text-white/70">
          <button
            onClick={() => setTab("filters")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2 ${tab === "filters" ? "bg-white/15 text-white" : ""}`}
          >
            <Wand2 className="h-3.5 w-3.5" /> Filters
          </button>
          <button
            onClick={() => setTab("adjust")}
            className={`flex items-center justify-center gap-1.5 rounded-full py-2 ${tab === "adjust" ? "bg-white/15 text-white" : ""}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
          </button>
        </div>
        {dirty && (
          <div className="mt-1 text-center text-[10px] text-white/40">
            exports clean — no location or camera data leaves your phone
          </div>
        )}
      </div>
    </div>
  );
}

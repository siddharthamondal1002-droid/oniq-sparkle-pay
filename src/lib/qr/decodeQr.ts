// Single QR decode helper used by BOTH the upload and live-camera paths.
// Feature-detection only — never branch on user agent.
// Fast path: window.BarcodeDetector (Chromium). Fallback: jsQR on ImageData
// (works everywhere, including iOS WebKit which has no BarcodeDetector).
import jsQR from "jsqr";

const MAX_EDGE = 1400;

/** True when the browser can open a camera stream at all. */
export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** Upload-QR decoding always works — canvas + jsQR need no special APIs. */
export function qrDecodeSupported(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDetector(): any | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Detector = (window as any).BarcodeDetector;
  if (!Detector) return null;
  try {
    return new Detector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

type Source = ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;

function sourceSize(src: Source): { w: number; h: number } {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight };
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  return { w: (src as ImageBitmap).width, h: (src as ImageBitmap).height };
}

function toImageData(src: Source, maxEdge: number | null): ImageData | null {
  const { w, h } = sourceSize(src);
  if (!w || !h) return null;
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(w, h)) : 1;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src as CanvasImageSource, 0, 0, cw, ch);
  try {
    return ctx.getImageData(0, 0, cw, ch);
  } catch {
    return null;
  }
}

function jsqrDecode(data: ImageData | null): string | null {
  if (!data) return null;
  const res = jsQR(data.data, data.width, data.height, { inversionAttempts: "attemptBoth" });
  return res?.data ?? null;
}

/** Decode a QR from any drawable source. */
export async function decodeQrFromSource(src: Source, opts?: { fullResRetry?: boolean }): Promise<string | null> {
  const detector = getDetector();
  if (detector) {
    try {
      const codes = await detector.detect(src as CanvasImageSource);
      if (codes?.[0]?.rawValue) return codes[0].rawValue as string;
    } catch {
      /* fall through to jsQR */
    }
  }
  const first = jsqrDecode(toImageData(src, MAX_EDGE));
  if (first) return first;
  if (opts?.fullResRetry) return jsqrDecode(toImageData(src, null));
  return null;
}

/** Decode a QR from a user-picked image file, entirely client-side. */
export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;

  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      try {
        const out = await decodeQrFromSource(bmp, { fullResRetry: true });
        if (out) return out;
      } finally {
        bmp.close?.();
      }
    } catch {
      /* fall through */
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("image load failed"));
    });
    return await decodeQrFromSource(img, { fullResRetry: true });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Decode the current frame of a playing <video>. */
export async function decodeQrFromVideo(video: HTMLVideoElement): Promise<string | null> {
  if (!video.videoWidth || !video.videoHeight) return null;
  return decodeQrFromSource(video);
}

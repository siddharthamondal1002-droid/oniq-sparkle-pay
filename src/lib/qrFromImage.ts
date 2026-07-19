// Decode a QR code from a user-picked image file, entirely client-side.
// No compression / re-encode: we hand the original image (as an ImageBitmap or
// HTMLImageElement) straight to BarcodeDetector — chat's JPEG compressor is
// tuned for LLM payload size, not QR edge fidelity.

export async function decodeQrFromImageFile(file: File): Promise<string | null> {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Detector = (window as any).BarcodeDetector;
  if (!Detector) return null;
  const detector = new Detector({ formats: ["qr_code"] });

  // Preferred path — ImageBitmap keeps original pixels.
  try {
    if (typeof createImageBitmap === "function") {
      const bmp = await createImageBitmap(file);
      try {
        const codes = await detector.detect(bmp);
        if (codes?.[0]?.rawValue) return codes[0].rawValue as string;
      } finally {
        bmp.close?.();
      }
    }
  } catch {
    /* fall through */
  }

  // Fallback — HTMLImageElement via object URL, no canvas re-encode.
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("image load failed"));
    });
    const codes = await detector.detect(img);
    if (codes?.[0]?.rawValue) return codes[0].rawValue as string;
  } catch {
    /* ignore */
  } finally {
    URL.revokeObjectURL(url);
  }
  return null;
}

export function qrDecodeSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

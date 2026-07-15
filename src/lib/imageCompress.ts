// Shared client-side image compressor.
// Reused across Ting, Smart Scout and Learn to keep upload payloads small.
export async function compressToJpeg(
  file: File,
  maxDim = 1024,
  quality = 0.7,
): Promise<{ dataUrl: string; base64: string; mime: "image/jpeg" }> {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = srcUrl;
    });
    let { width, height } = img;
    if (width > height && width > maxDim) {
      height = Math.round(height * (maxDim / width));
      width = maxDim;
    } else if (height >= width && height > maxDim) {
      width = Math.round(width * (maxDim / height));
      height = maxDim;
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.split(",")[1] ?? "";
    return { dataUrl, base64, mime: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

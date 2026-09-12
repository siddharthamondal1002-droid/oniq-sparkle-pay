import { useEffect, useRef, useState } from "react";
import { Camera, X, ImagePlus, Link2 } from "lucide-react";
import { toast } from "sonner";
import { parseUpiUri } from "@/routes/_authenticated/app.scan";
import { decodeQrFromImageFile, decodeQrFromVideo, cameraSupported } from "@/lib/qr/decodeQr";
import { APP_ORIGIN } from "@/config/appOrigin";

type Prefill = { pa: string; pn?: string; am?: string; tn?: string };

export function UpiScannerOverlay({
  onDecode,
  onClose,
}: {
  onDecode: (p: Prefill) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [canUseCamera] = useState(() => cameraSupported());
  const [permError, setPermError] = useState<string | null>(null);
  const [decodingFile, setDecodingFile] = useState(false);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // reset immediately so re-picking the same file still fires change
    e.target.value = "";
    if (!file) return;
    setDecodingFile(true);
    try {
      const raw = await decodeQrFromImageFile(file);
      if (!raw) {
        toast.error("couldn't read this QR — try a clearer photo");
        return;
      }
      // Feed into the exact same pipeline as the live scanner.
      const parsed = parseUpiUri(raw);
      if (!parsed) {
        toast.error("That QR isn't a UPI payment code");
        return;
      }
      stopCamera();
      toast.success(`Found ${parsed.pn || parsed.pa} ✅`);
      onDecode(parsed);
      onClose();
    } catch {
      toast.error("couldn't read this QR — try a clearer photo");
    } finally {
      setDecodingFile(false);
    }
  }

  function stopCamera() {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function close() {
    stopCamera();
    onClose();
  }

  // iOS requires a user gesture — camera only starts from this tap.
  async function startCamera() {
    if (!cameraSupported()) return;
    setPermError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      runningRef.current = true;
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      let last = 0;
      const tick = async (now: number) => {
        if (!runningRef.current || !streamRef.current || !videoRef.current) return;
        if (now - last >= 100) {
          last = now;
          const raw = await decodeQrFromVideo(videoRef.current).catch(() => null);
          if (raw) {
            const parsed = parseUpiUri(raw);
            if (!parsed) {
              toast.error("That QR isn't a UPI payment code");
            } else {
              stopCamera();
              toast.success(`Found ${parsed.pn || parsed.pa} ✅`);
              onDecode(parsed);
              onClose();
              return;
            }
          }
        }
        if (runningRef.current) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      setPermError("Camera unavailable — check permissions");
    }
  }

  useEffect(() => {
    const onHide = () => {
      if (document.hidden) stopCamera();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" data-testid="upi-scan-overlay">
      <div className="flex items-center justify-between px-5 pt-12 pb-3 text-white">
        <span className="font-display text-lg font-semibold">Scan UPI QR 📷</span>
        <button
          onClick={close}
          aria-label="Cancel scanner"
          className="press grid h-9 w-9 place-items-center rounded-full bg-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
            <div>
              <Camera className="mx-auto h-10 w-10 text-white/80" />
              <p className="mt-3 text-sm text-white/80">
                {!canUseCamera
                  ? "This browser blocks camera access. Open oniqhub.com in Safari or Chrome to scan live."
                  : permError ?? "Tap to start the camera"}
              </p>
              {canUseCamera ? (
                <button
                  onClick={startCamera}
                  className="press mt-4 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black"
                >
                  Scan QR
                </button>
              ) : (
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(APP_ORIGIN);
                      toast.success("link copied ✨");
                    } catch {
                      toast.error("couldn't copy — it's oniqhub.com");
                    }
                  }}
                  className="press mt-4 inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white"
                >
                  <Link2 className="h-4 w-4" /> Copy link
                </button>
              )}
            </div>
          </div>
        )}
        {scanning && (
          <div className="pointer-events-none absolute inset-10 rounded-3xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
        )}
      </div>

      <div className="px-5 pb-8 pt-3 text-center text-xs text-white/70">
        point at any UPI QR — shop counters, PhonePe/GPay/Paytm stickers all work
        <div className="mt-2 text-[11px] text-white/50">
          Scanning a QR only ever sends money — you never need your UPI PIN to receive it.
          <br />
          Suspect fraud? Report at 1930 or cybercrime.gov.in.
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={decodingFile}
            className="press inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            data-testid="upi-scan-upload"
          >
            <ImagePlus className="h-4 w-4" />
            {decodingFile ? "reading image…" : "upload QR 🖼️"}
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickFile}
      />
    </div>
  );
}

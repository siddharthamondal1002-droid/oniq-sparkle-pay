import { useEffect, useRef, useState } from "react";
import { Camera, X, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import { parseUpiUri } from "@/routes/_authenticated/app.scan";
import { decodeQrFromImageFile, qrDecodeSupported } from "@/lib/qrFromImage";

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
  const runningRef = useRef(true);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(true);
  const [permError, setPermError] = useState<string | null>(null);

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

  useEffect(() => {
    runningRef.current = true;
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
    // auto-start on mount
    (async () => {
      if (!("BarcodeDetector" in window)) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!runningRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setScanning(true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Detector = (window as any).BarcodeDetector;
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (!runningRef.current || !streamRef.current || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0].rawValue) {
              const parsed = parseUpiUri(codes[0].rawValue as string);
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
          } catch {
            /* frame not ready */
          }
          if (runningRef.current) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch {
        setPermError("Camera unavailable — check permissions");
      }
    })();
    return () => stopCamera();
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
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
            <div>
              <Camera className="mx-auto h-10 w-10 text-white/80" />
              <p className="mt-3 text-sm text-white/80">
                {!supported
                  ? "Live scanning needs Android Chrome — cancel & paste the link on the UPI screen instead"
                  : permError ?? "Starting camera…"}
              </p>
            </div>
          </div>
        )}
        {scanning && (
          <div className="pointer-events-none absolute inset-10 rounded-3xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
        )}
      </div>

      <div className="px-5 pb-8 pt-3 text-center text-xs text-white/70">
        point at any UPI QR — shop counters, PhonePe/GPay/Paytm stickers all work
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { activeQrDecoder, cameraSupported } from "@/lib/qr/decodeQr";

/**
 * WHAT THIS DEVICE — the one you are holding — can actually do.
 *
 * WHY IT IS HERE AND NOT ON `/app/diag`, WHERE IT ALSO LIVES. `/app/diag` is
 * reachable only by TYPING the URL, and inside the Capacitor WebView there is
 * no address bar to type into. That made the whole screen unreachable on the
 * one device whose answer matters. The same trap had already been hit today
 * with `phoneLoginVisible`'s `?phone=1` escape hatch, for the same reason:
 * a fallback that needs a URL bar is not a fallback for an app.
 *
 * AND A LINK WOULD NOT HAVE FIXED IT. Measured 2026-08-26 and recorded beside
 * the Runway anchor in `app.admin.tsx`: on the owner's device both a router
 * `Link` and a plain anchor to a separate admin route did NOTHING, while these
 * section chips demonstrably work. So the readings are rendered INLINE, in a
 * section of a screen already reachable by tapping (Profile → Admin), rather
 * than behind one more navigation that may silently no-op.
 *
 * READ IN THE APP, NOT IN MOBILE CHROME. The two genuinely differ — the
 * Capacitor WebView blocked reCAPTCHA on 2026-09-06 while every browser
 * allowed it — and this panel reports the engine it is running in, so a
 * reading taken in Chrome answers a question nobody asked.
 *
 * THE VALUES ARE READ AFTER MOUNT, ON PURPOSE. `activeQrDecoder()` probes
 * `window.BarcodeDetector` and returns "jsqr" whenever `window` is undefined,
 * which is exactly what the server sees. Rendering it during SSR would print a
 * confident "jsqr" for every device, including ones that expose the detector —
 * a wrong answer that looks like a measurement. `mounted` gates it so the
 * number shown is always the browser's own.
 */
export function DevicePanel() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const decoder = mounted ? activeQrDecoder() : null;
  const camera = mounted ? cameraSupported() : null;

  return (
    <div className="mt-4 rounded-3xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">This device</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Read inside the ONIQ app. A mobile browser can answer differently.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <Row
          label="qr decoder"
          value={decoder ?? "reading…"}
          hint={
            decoder === null
              ? "measured in the browser, not on the server"
              : decoder === "barcode-detector"
                ? "Google ML Kit via Play Services — Scan & Pay already uses it"
                : "pure-JS fallback — this engine exposes no detector"
          }
          testid="device-qr-decoder"
        />
        <Row
          label="camera"
          value={camera === null ? "reading…" : camera ? "available" : "blocked"}
          testid="device-camera"
        />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  testid,
}: {
  label: string;
  value: string;
  hint?: string;
  testid: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3" data-testid={testid}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold break-words">{value}</dd>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

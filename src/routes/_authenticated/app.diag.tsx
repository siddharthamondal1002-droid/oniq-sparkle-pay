import { activeQrDecoder, cameraSupported } from "@/lib/qr/decodeQr";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Activity, Copy } from "lucide-react";
import { toast } from "sonner";
import { formatFrameReport, heapMb, probeFrames, type FrameReport } from "@/lib/frameProbe";
import { WINDOW_STEP } from "@/lib/chat/messageWindow";
import { MAX_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES, formatBytes } from "@/config/mediaStorage";
import { planParts } from "@/lib/upload/chunkedUpload";

export const Route = createFileRoute("/_authenticated/app/diag")({
  component: DiagScreen,
});

/**
 * The [HW] checks, as a screen.
 *
 * Six items in the mega-loop can only be answered on a real mid-range Android
 * phone on mobile data: baseline fps, fps after A1, peak memory during a
 * 200 MB upload, resume across a network switch, a real merchant UPI scan, and
 * a real profile scan. None of them reproduce in a desktop preview, and every
 * one of them was still unverified when the code shipped.
 *
 * Leaving them as a list in a commit message makes them nobody's job. This
 * turns them into something a person holding the phone can run in a minute and
 * copy out. It does not perform the checks — it MEASURES, and reports numbers
 * with enough context to be read honestly.
 *
 * Deliberately NOT linked from anywhere. It is reached by typing /app/diag,
 * because it is an instrument, not a feature.
 *
 * WHAT IT CANNOT DO, STATED HERE SO THE SCREEN IS NOT MISTAKEN FOR PROOF
 *
 *   - performance.memory is the JS heap, not process RSS. Native-side
 *     buffering will not show up. Pair it with Android Studio's profiler for
 *     the number that goes in a report.
 *   - The scroll test measures whatever is on screen while it runs, so it must
 *     be started and then immediately scrolled by hand in a long chat. It
 *     cannot scroll for you, and a still screen will read as a perfect 60.
 *   - It cannot verify a UPI scan or a profile scan at all. Those need a real
 *     code in front of a real camera.
 */
function DiagScreen() {
  const [report, setReport] = useState<FrameReport | null>(null);
  const [running, setRunning] = useState(false);
  const [heapNow, setHeapNow] = useState<number | null>(null);

  async function runFrames() {
    setRunning(true);
    setReport(null);
    try {
      // 5 s is long enough to catch a stutter and short enough that a person
      // will actually keep scrolling for the whole window.
      const r = await probeFrames(5000);
      setReport(r);
      setHeapNow(heapMb());
    } finally {
      setRunning(false);
    }
  }

  const parts = planParts(MAX_UPLOAD_BYTES);

  const summary = [
    `ONIQ device check`,
    `ua=${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    `dpr=${typeof window !== "undefined" ? window.devicePixelRatio : "?"}`,
    `screen=${typeof window !== "undefined" ? `${window.innerWidth}x${window.innerHeight}` : "?"}`,
    report ? `frames: ${formatFrameReport(report)}` : `frames: not run`,
    `heapMb=${heapNow ?? "unavailable"}`,
    `chatWindow=${WINDOW_STEP} rows`,
    `uploadCap=${formatBytes(MAX_UPLOAD_BYTES)} chunk=${formatBytes(UPLOAD_CHUNK_BYTES)} parts=${parts.length}`,
  ].join("\n");

  return (
    <div className="px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Device check</h1>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        For measuring on a real phone on mobile data. Numbers from a desktop preview mean nothing
        here — say so rather than reporting them as passed.
      </p>

      {/* ---- frames ---- */}
      <section className="mt-5 rounded-3xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4" /> Scroll smoothness
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Tap start, then <strong>immediately scroll a long chat</strong> for five seconds. The
          probe measures the frames it sees — a still screen reads as perfect and proves nothing.
        </p>
        <button
          type="button"
          onClick={runFrames}
          disabled={running}
          data-testid="diag-frames"
          className="press mt-3 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {running ? "measuring… scroll now" : "Start 5s measurement"}
        </button>

        {report && (
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Stat label="fps (mean)" value={String(report.fps)} />
            <Stat label="worst frame" value={`${report.worstFrameMs} ms`} />
            <Stat
              label="dropped"
              value={`${report.dropped}/${report.frames}`}
              hint={
                report.frames ? `${Math.round((report.dropped / report.frames) * 1000) / 10}%` : ""
              }
            />
            {/* The budget is DERIVED from the display, not assumed to be 16.7.
                On a 90 or 120 Hz panel a janky scroll would score perfectly
                against 16.7 — the exact false pass this instrument prevents. */}
            <Stat
              label="frame budget"
              value={`${report.budgetMs} ms`}
              hint="measured, not assumed"
            />
          </dl>
        )}
      </section>

      {/* ---- memory ---- */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Memory</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          JS heap only — this is not process memory, so native-side buffering will not appear here.
          For the upload check, watch that this stays flat while a large file uploads; a curve that
          tracks file size means something is still buffering the whole file.
        </p>
        <button
          type="button"
          onClick={() => setHeapNow(heapMb())}
          className="press mt-3 rounded-full border border-border px-4 py-2 text-xs font-semibold"
        >
          Read heap
        </button>
        <p className="mt-2 text-xs">
          {heapNow === null ? (
            <span className="text-muted-foreground">
              not exposed by this browser — that is a missing measurement, not a good one
            </span>
          ) : (
            <span className="font-mono">{heapNow} MB</span>
          )}
        </p>
      </section>

      {/* ---- what the code is configured to do ---- */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Configured limits</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Stat label="chat rows mounted" value={`${WINDOW_STEP}`} hint="server fetches 200" />
          <Stat label="upload cap" value={formatBytes(MAX_UPLOAD_BYTES)} />
          <Stat label="chunk size" value={formatBytes(UPLOAD_CHUNK_BYTES)} />
          <Stat label="parts at cap" value={`${parts.length}`} hint="resume granularity" />
          {/* WHICH QR DECODER THIS DEVICE ACTUALLY USES.
              "barcode-detector" means Google's — on Android, Chromium backs the
              Shape Detection API with Play Services' ML Kit scanner, so Scan &
              Pay is already running Google's detector. "jsqr" means this engine
              exposes none and the pure-JS fallback is doing the work: slower per
              frame and weaker on the dense, low-contrast codes printed on real
              shop counters.
              Read this INSIDE THE APP, not in a mobile browser. The two can
              differ, and today the Capacitor WebView turned out to block
              reCAPTCHA while every browser allowed it. */}
          <Stat
            label="qr decoder"
            value={activeQrDecoder()}
            hint={
              activeQrDecoder() === "barcode-detector"
                ? "Google ML Kit via Play Services"
                : "pure-JS fallback — no detector exposed here"
            }
          />
          <Stat label="camera" value={cameraSupported() ? "available" : "blocked"} />
        </dl>
      </section>

      {/* ---- the checks a screen cannot do ---- */}
      <section className="mt-4 rounded-3xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Still needs a human</h2>
        <ul className="mt-2 space-y-2 text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">Real merchant UPI scan.</strong> Point the scanner
            at a shop QR and confirm the payee and amount are right before paying. Merchant codes
            carry fields ONIQ does not model, and dropping them makes a UPI app decline the payment.
          </li>
          <li>
            <strong className="text-foreground">Real ONIQ profile scan.</strong> Have someone scan
            your code from My QR and land on your profile.
          </li>
          <li>
            <strong className="text-foreground">Upload resume.</strong> Start a large upload, turn
            wifi off mid-transfer so it falls back to mobile data, and confirm it continues instead
            of restarting.
          </li>
        </ul>
      </section>

      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(summary);
            toast.success("copied — paste it into the report");
          } catch {
            toast.error("couldn't copy");
          }
        }}
        className="press mt-5 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold"
      >
        <Copy className="h-4 w-4" /> Copy results
      </button>

      <pre className="mt-3 overflow-x-auto rounded-2xl border border-border bg-muted/40 p-3 text-[10px] leading-relaxed">
        {summary}
      </pre>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-2">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm">{value}</dd>
      {hint && <dd className="text-[10px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

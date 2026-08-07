// Frame-rate probe — the instrument A1 needs before A1 can be judged.
//
// WHY THIS EXISTS
//
// The loop says: "Measure a baseline first. Without a before number there's no
// way to know if this worked." That is correct and it is also a blocker,
// because the number has to come off a real mid-range Android phone on mobile
// data. It cannot be taken in a desktop preview, and a desktop preview will
// happily report a beautiful 60 fps no matter how bad the list is — which is
// exactly the trap the loop warns about with its [HW] markers.
//
// So this is the instrument, not the fix. It runs on the device, in the real
// app, over the real message list, and prints numbers that can be written down
// before and after.
//
// WHAT IT REPORTS, AND WHY THESE NUMBERS
//
//   fps          — mean frames per second over the window. The headline, and
//                  on its own the least useful of the three.
//   dropped      — frames that took longer than one budget. This is what a
//                  user actually perceives as jank; a thread that renders 58
//                  fps evenly feels smooth, and one that renders 60 fps with
//                  ten 100 ms stalls feels broken.
//   worstFrameMs — the single longest frame. The loop asks for it by name,
//                  because a mean hides precisely the stall people complain
//                  about.
//
// The budget is derived from the display's own rate, not assumed to be 16.7 ms.
// On a 90 or 120 Hz panel the budget is 11.1 or 8.3 ms, and measuring against
// 16.7 there would score a janky 120 Hz scroll as perfect.
//
// OFF UNLESS ASKED FOR. No timer, no rAF loop, nothing running for ordinary
// users — an fps meter that costs frames is not an fps meter.

export type FrameReport = {
  /** Mean frames per second across the sample window. */
  fps: number;
  /** Frames that exceeded one refresh budget. */
  dropped: number;
  /** Total frames observed. */
  frames: number;
  /** Longest single frame, milliseconds. */
  worstFrameMs: number;
  /** Refresh budget used, milliseconds — derived, not assumed. */
  budgetMs: number;
  /** Sample duration, milliseconds. */
  durationMs: number;
};

/** Measured, because the whole point of A1 is that the panel may not be 60 Hz. */
async function measureBudgetMs(): Promise<number> {
  return new Promise((resolve) => {
    const stamps: number[] = [];
    const tick = (t: number) => {
      stamps.push(t);
      if (stamps.length < 20) {
        requestAnimationFrame(tick);
        return;
      }
      const deltas = stamps.slice(1).map((s, i) => s - stamps[i]);
      deltas.sort((a, b) => a - b);
      // Median, so one stall during calibration does not inflate the budget
      // and quietly excuse every later stall.
      const median = deltas[Math.floor(deltas.length / 2)];
      resolve(Number.isFinite(median) && median > 1 ? median : 16.7);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Sample frame timing for `durationMs`.
 *
 * Scroll the list while this runs — an idle screen reports a perfect score on
 * the worst list ever written, and that reading is worthless.
 */
export async function probeFrames(durationMs = 5000): Promise<FrameReport> {
  const budgetMs = await measureBudgetMs();
  // 1.5 budgets, not 1.0: a frame arriving a hair late is measurement noise,
  // while one taking half again as long has genuinely missed a vsync.
  const dropThreshold = budgetMs * 1.5;

  return new Promise((resolve) => {
    let last = performance.now();
    const start = last;
    let frames = 0;
    let dropped = 0;
    let worstFrameMs = 0;

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      frames += 1;
      if (delta > worstFrameMs) worstFrameMs = delta;
      if (delta > dropThreshold) dropped += 1;

      if (now - start < durationMs) {
        requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - start;
      resolve({
        fps: Math.round((frames / elapsed) * 1000 * 10) / 10,
        dropped,
        frames,
        worstFrameMs: Math.round(worstFrameMs * 10) / 10,
        budgetMs: Math.round(budgetMs * 10) / 10,
        durationMs: Math.round(elapsed),
      });
    };
    requestAnimationFrame(tick);
  });
}

/** One line, copy-pasteable into a report. */
export function formatFrameReport(r: FrameReport): string {
  const pct = r.frames ? Math.round((r.dropped / r.frames) * 1000) / 10 : 0;
  return `fps=${r.fps} dropped=${r.dropped}/${r.frames} (${pct}%) worst=${r.worstFrameMs}ms budget=${r.budgetMs}ms over ${r.durationMs}ms`;
}

/**
 * Peak JS heap during a run, where the browser exposes it.
 *
 * For the A4 upload check the loop asks for peak WebView memory during a
 * 200 MB upload, and demands it stay FLAT — a curve tracking file size means
 * something still buffers the whole file.
 *
 * performance.memory is Chromium-only and non-standard, which suits us: the
 * Android WebView is Chromium. It reports the JS heap, not the process RSS, so
 * it will not catch native-side buffering — read it as a strong signal, not as
 * the whole truth, and pair it with Android Studio's profiler for the number
 * that goes in the report.
 */
export function heapMb(): number | null {
  const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
  const used = perf.memory?.usedJSHeapSize;
  return typeof used === "number" ? Math.round((used / 1024 / 1024) * 10) / 10 : null;
}

/**
 * Poll the heap during a long operation and report the peak.
 *
 * Returns nulls rather than zeros where the browser withholds the figure, so a
 * missing measurement can never be mistaken for a good one.
 */
export async function peakHeapDuring<T>(
  work: () => Promise<T>,
  sampleMs = 250,
): Promise<{ result: T; peakMb: number | null; startMb: number | null }> {
  const startMb = heapMb();
  let peakMb = startMb;
  const timer = setInterval(() => {
    const now = heapMb();
    if (now !== null && (peakMb === null || now > peakMb)) peakMb = now;
  }, sampleMs);
  try {
    const result = await work();
    return { result, peakMb, startMb };
  } finally {
    clearInterval(timer);
  }
}

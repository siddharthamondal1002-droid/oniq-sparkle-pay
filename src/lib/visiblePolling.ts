/**
 * Read-only UI polling: pause offscreen, refresh on return, never overlap.
 *
 * A tick that resolves `false` means the thing being watched has settled, so
 * the timer stops itself rather than waiting for a React state round trip.
 * A rejected tick is swallowed here — the caller owns its error UI, and an
 * unhandled rejection must not end later recovery.
 */
export function startVisiblePolling(
  tick: () => void | boolean | Promise<void | boolean>,
  everyMs: number,
  immediate = true,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const stopTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const stop = () => {
    stopped = true;
    stopTimer();
    document.removeEventListener("visibilitychange", onVisibility);
  };

  const run = () => {
    if (stopped || document.visibilityState !== "visible" || inFlight) return;
    inFlight = true;
    void Promise.resolve(tick())
      .then((result) => {
        if (result === false) stop();
      })
      .catch(() => {
        /* the caller owns the error UI; keep polling alive */
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const startTimer = () => {
    if (stopped || timer !== null || document.visibilityState !== "visible") return;
    run();
    timer = setInterval(run, everyMs);
  };

  function onVisibility() {
    if (document.visibilityState === "visible") startTimer();
    else stopTimer();
  }

  if (immediate || document.visibilityState !== "visible") onVisibility();
  else if (document.visibilityState === "visible") timer = setInterval(run, everyMs);
  document.addEventListener("visibilitychange", onVisibility);
  return stop;
}

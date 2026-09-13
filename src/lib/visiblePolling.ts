export function startVisiblePolling(
  tick: () => void | Promise<void>,
  everyMs: number,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const run = () => {
    if (stopped || document.visibilityState !== "visible" || inFlight) return;
    inFlight = true;
    void Promise.resolve(tick()).finally(() => {
      inFlight = false;
    });
  };

  const stopTimer = () => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  };

  const startTimer = () => {
    if (stopped || timer !== null || document.visibilityState !== "visible") return;
    run();
    timer = setInterval(run, everyMs);
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") startTimer();
    else stopTimer();
  };

  onVisibility();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    stopTimer();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

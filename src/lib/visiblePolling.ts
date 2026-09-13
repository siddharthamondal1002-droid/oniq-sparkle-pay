/** Read-only UI polling: pause offscreen, refresh on return, never overlap. */
export function startVisiblePolling(
  task: () => void | boolean | Promise<void | boolean>,
  intervalMs: number,
  immediate = true,
): () => void {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!stopped && document.visibilityState === "visible") {
      timer = setTimeout(() => void tick(), intervalMs);
    }
  };
  const tick = async () => {
    if (stopped || running || document.visibilityState !== "visible") return;
    clear();
    running = true;
    try {
      // A terminal job can stop before React processes its state update.
      if ((await task()) === false) stop();
    } catch {
      // Callers own the error UI. A failed read must not kill later recovery.
    } finally {
      running = false;
      schedule();
    }
  };
  const onVisibility = () => {
    clear();
    if (document.visibilityState === "visible") void tick();
  };
  const stop = () => {
    stopped = true;
    clear();
    document.removeEventListener("visibilitychange", onVisibility);
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (immediate) void tick();
  else schedule();
  return stop;
}

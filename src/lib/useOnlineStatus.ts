import { useSyncExternalStore } from "react";

/**
 * P11 — is the device online right now?
 *
 * ONIQ had no network-state awareness anywhere: offline looked exactly like
 * "empty" or a bare error toast. This is the one primitive that fixes that —
 * a global banner and any screen that wants to say "you're offline" instead of
 * "nothing here" reads it.
 *
 * Built on useSyncExternalStore because `navigator.onLine` + the online/offline
 * events ARE an external store: this is the tear-free, SSR-safe way to read
 * them in React 19. `navigator.onLine` is a coarse signal (it reports link
 * state, not real reachability), so it is used to REASSURE, never to block —
 * a false "online" simply falls through to the existing error handling.
 *
 * The store parts are exported so they can be unit-tested without a renderer.
 */
export function subscribeOnline(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function getOnlineSnapshot(): boolean {
  // Default to online when the API is unavailable — never trap the UI in a
  // false "offline" state.
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Server render assumes online; the client corrects on hydration. */
function getServerSnapshot(): boolean {
  return true;
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot);
}

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

/**
 * Tracks a single "active" media source across the app.
 * When a new source registers as playing, the previous one is paused + muted.
 *
 * Accepts either a raw HTMLMediaElement (video/audio tag) OR a generic
 * "controllable" object with `pause()` / optional `mute()`. This lets
 * non-HTMLMediaElement players (e.g. the YouTube IFrame player instance)
 * participate in the same single-audio-source coordination.
 */
export type Controllable = {
  pause: () => void;
  mute?: () => void;
};

type Registrable = HTMLMediaElement | Controllable;

type Ctx = {
  register: (el: Registrable | null) => void;
  isActive: (el: Registrable | null) => boolean;
};

const MediaCtx = createContext<Ctx | null>(null);

function silence(prev: Registrable) {
  try {
    prev.pause();
  } catch {
    /* noop */
  }
  try {
    // Prefer an explicit mute() (YouTube player); fall back to
    // HTMLMediaElement.muted for raw <video>/<audio> tags.
    if (typeof (prev as Controllable).mute === "function") {
      (prev as Controllable).mute!();
    } else if ("muted" in (prev as HTMLMediaElement)) {
      (prev as HTMLMediaElement).muted = true;
    }
  } catch {
    /* noop */
  }
}

export function MediaProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<Registrable | null>(null);

  const register = useCallback((el: Registrable | null) => {
    if (!el) return;
    const prev = activeRef.current;
    if (prev && prev !== el) silence(prev);
    activeRef.current = el;
  }, []);

  const isActive = useCallback((el: Registrable | null) => activeRef.current === el, []);

  return <MediaCtx.Provider value={{ register, isActive }}>{children}</MediaCtx.Provider>;
}

export function useMediaCoordinator(): Ctx {
  const ctx = useContext(MediaCtx);
  if (!ctx) {
    return {
      register: () => {},
      isActive: () => false,
    };
  }
  return ctx;
}

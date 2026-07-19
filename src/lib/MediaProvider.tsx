import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

/**
 * Tracks a single "active" media element (video/audio) across the app.
 * When a new element registers as playing, the previous one is paused + muted.
 * Purely presentation-side coordination — no data fetching.
 */
type MediaEl = HTMLMediaElement;

type Ctx = {
  register: (el: MediaEl | null) => void;
  isActive: (el: MediaEl | null) => boolean;
};

const MediaCtx = createContext<Ctx | null>(null);

export function MediaProvider({ children }: { children: ReactNode }) {
  const activeRef = useRef<MediaEl | null>(null);

  const register = useCallback((el: MediaEl | null) => {
    if (!el) return;
    const prev = activeRef.current;
    if (prev && prev !== el) {
      try {
        prev.pause();
        prev.muted = true;
      } catch {
        /* noop */
      }
    }
    activeRef.current = el;
  }, []);

  const isActive = useCallback((el: MediaEl | null) => activeRef.current === el, []);

  return <MediaCtx.Provider value={{ register, isActive }}>{children}</MediaCtx.Provider>;
}

export function useMediaCoordinator(): Ctx {
  const ctx = useContext(MediaCtx);
  // Safe fallback if used outside provider — no-ops.
  if (!ctx) {
    return {
      register: () => {},
      isActive: () => false,
    };
  }
  return ctx;
}

/**
 * WHICH film a prepared share belongs to, and the rules that keep it honest.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN THE COMPONENT. The first version
 * of the two-step share kept a single `ready` file tagged only with a SURFACE
 * name. That made every saved row's button read "Send now" the moment ANY
 * saved film was prepared, and tapping any of them sent the first one. Three
 * more faults live in the same place: a slow fetch could land after the person
 * had moved to another film and arm the older file; a deleted or closed film
 * left an armed button pointing at bytes that were gone; and two fast taps
 * could both reach the sheet.
 *
 * None of those are reachable from a component test in this repo — the vitest
 * environment is "node", there is no DOM and no renderer — so the decisions
 * live here, where they are executed by the tests rather than read from source.
 * The component holds no copy of any of this logic.
 */
import { prepareVideoShare, shareReadyFile } from "@/lib/share";

export const SHARE_PAYLOAD = {
  title: "My ONIQ Story",
  text: "Made with AI on ONIQ 🎬 oniqhub.com",
  url: "https://oniqhub.com",
};

/** A prepared file belongs to one kind AND one id. Never to a surface. */
export type ShareSource = { kind: "film" | "saved"; id: string };

export const sameSource = (a: ShareSource | undefined | null, b: ShareSource): boolean =>
  a?.kind === b.kind && a?.id === b.id;

/** What a finished share can say, from either step. */
export type ShareOutcome = "shared" | "cancelled" | "download-started" | "failed" | "unsupported";

/** A fetched film waiting for its own tap, with the copy for however it ends. */
export type ReadyShare = {
  file: File;
  source: ShareSource;
  surface: string;
  whenFailed: string;
  whenUnsupported: string;
};

export type ShareSnapshot = {
  ready: ReadyShare | null;
  sharing: boolean;
  pct: number | null;
};

type PrepareArgs = {
  source: ShareSource;
  surface: string;
  url: string;
  fileName: string;
  whenFailed: string;
  whenUnsupported: string;
};

/** Injected so the tests drive the real flow rather than a copy of it. */
export type ShareIo = {
  prepare: typeof prepareVideoShare;
  send: typeof shareReadyFile;
};

export function createShareBinding(
  io: ShareIo = { prepare: prepareVideoShare, send: shareReadyFile },
) {
  let snapshot: ShareSnapshot = { ready: null, sharing: false, pct: null };
  const listeners = new Set<() => void>();
  // Whoever took the LAST ticket wins. A fetch takes seconds, so a person can
  // start one film and tap another before the first lands.
  let seq = 0;
  // One send at a time: the send call is deliberately synchronous, so two fast
  // taps would otherwise both reach the sheet with the same file.
  let sending = false;

  const set = (next: Partial<ShareSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const l of listeners) l();
  };

  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    getSnapshot: () => snapshot,

    /**
     * STEP ONE: fetch the bytes. On native the platform sheet finishes here.
     * On the web this leaves a file armed for ONE source; a stale fetch is
     * discarded rather than armed.
     */
    async prepare(args: PrepareArgs): Promise<{ armed: true } | { outcome: ShareOutcome | null }> {
      const ticket = ++seq;
      set({ sharing: true, ready: null, pct: null });
      try {
        const r = await io.prepare(args.url, args.fileName, SHARE_PAYLOAD, (pct) => {
          if (ticket === seq) set({ pct });
        });
        if (ticket !== seq) return { outcome: null };
        if (r.kind === "ready") {
          set({
            ready: {
              file: r.file,
              source: args.source,
              surface: args.surface,
              whenFailed: args.whenFailed,
              whenUnsupported: args.whenUnsupported,
            },
          });
          return { armed: true };
        }
        return { outcome: r.outcome };
      } finally {
        if (ticket === seq) set({ sharing: false, pct: null });
      }
    },

    /**
     * STEP TWO. NOT async, and nothing is awaited before the send — an `await`
     * in front of it silently restores the refusal the split exists to prevent.
     * A caller naming a different film than the armed one is refused.
     */
    sendNow(source: ShareSource, onOutcome: (r: ReadyShare, o: ShareOutcome) => void): boolean {
      const r = snapshot.ready;
      if (!r || !sameSource(r.source, source) || sending) return false;
      sending = true;
      void io.send(r.file, SHARE_PAYLOAD).then((outcome) => {
        sending = false;
        if (sameSource(snapshot.ready?.source, source)) set({ ready: null });
        onOutcome(r, outcome as ShareOutcome);
      });
      return true;
    },

    /** Drop an armed file whose film is closed, deleted, or off the phone. */
    invalidate(openFilmId: string | null, savedIds: readonly string[]) {
      const cur = snapshot.ready;
      if (!cur) return;
      const alive =
        cur.source.kind === "film"
          ? cur.source.id === openFilmId
          : savedIds.includes(cur.source.id);
      if (!alive) set({ ready: null });
    },
  };
}

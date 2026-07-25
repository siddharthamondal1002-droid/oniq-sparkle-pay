// One-time, non-nagging prompt: only shown AFTER the user has recorded at
// least one missed call and only if they haven't dismissed it before.
// Deep-links to Android's per-app full-screen-intent settings page.
import { useEffect, useState } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { X, BellRing } from "lucide-react";

const LS_MISSED = "oniq.calls.missedCount";
const LS_DISMISSED = "oniq.calls.fsiPromptDismissed";

interface CallSettingsPlugin {
  openFullScreenIntentSettings(): Promise<{ opened: boolean }>;
  canUseFullScreenIntent(): Promise<{ allowed: boolean }>;
}
const CallSettings = registerPlugin<CallSettingsPlugin>("CallSettings");

export function bumpMissedCallCount() {
  try {
    const n = Number(localStorage.getItem(LS_MISSED) || "0") + 1;
    localStorage.setItem(LS_MISSED, String(n));
    window.dispatchEvent(new Event("oniq:missed-call"));
  } catch {}
}

export function FullScreenIntentPrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    let cancelled = false;
    const check = async () => {
      try {
        if (localStorage.getItem(LS_DISMISSED) === "1") return;
        const missed = Number(localStorage.getItem(LS_MISSED) || "0");
        if (missed < 1) return;
        const res = await CallSettings.canUseFullScreenIntent().catch(() => ({ allowed: true }));
        if (!cancelled && !res.allowed) setOpen(true);
      } catch {}
    };
    check();
    const onMissed = () => check();
    window.addEventListener("oniq:missed-call", onMissed);
    return () => {
      cancelled = true;
      window.removeEventListener("oniq:missed-call", onMissed);
    };
  }, []);

  if (!open) return null;

  const dismiss = () => {
    try { localStorage.setItem(LS_DISMISSED, "1"); } catch {}
    setOpen(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-24 z-[80] mx-auto max-w-md px-4">
      <div className="flex items-start gap-3 rounded-2xl border border-primary/40 bg-[#12141c]/95 p-4 shadow-xl backdrop-blur-xl">
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary/20 text-primary">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">
            Never miss a call
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Allow ONIQ to show incoming calls over your lock screen so they ring like a normal phone.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={async () => {
                try { await CallSettings.openFullScreenIntentSettings(); } catch {}
                dismiss();
              }}
              className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Open settings
            </button>
            <button onClick={dismiss} className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted-foreground">
              Not now
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-white/5">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

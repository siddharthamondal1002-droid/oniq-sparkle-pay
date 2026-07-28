import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { Bell, MapPin, Camera, Contact2, Check, X } from "lucide-react";
import { initPush } from "@/lib/push";

const FLAG = "oniq.onboard.v1";

type PermState = "granted" | "denied" | "prompt" | "unknown";

async function queryPerm(name: PermissionName): Promise<PermState> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
    const r = await navigator.permissions.query({ name } as PermissionDescriptor);
    return (r.state as PermState) ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function PermissionsOnboarding() {
  const [open, setOpen] = useState(false);
  const [notif, setNotif] = useState<PermState>("unknown");
  const [geo, setGeo] = useState<PermState>("unknown");
  const [cam, setCam] = useState<PermState>("unknown");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      if (localStorage.getItem(FLAG)) return;
      setOpen(true);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    // Web permission status hints (native APIs don't expose Permissions API)
    if (typeof window !== "undefined" && "Notification" in window) {
      const p = Notification.permission;
      setNotif(p === "default" ? "prompt" : (p as PermState));
    }
    queryPerm("geolocation" as PermissionName).then(setGeo);
    queryPerm("camera" as PermissionName).then(setCam);
  }, [open]);

  const finish = () => {
    try { localStorage.setItem(FLAG, "1"); } catch { /* noop */ }
    setOpen(false);
  };

  const askNotifications = async () => {
    setBusy("notif");
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          await initPush();
          setNotif("granted");
          toast.success("notifications on 🔔");
        } catch (e: unknown) {
          const name = (e as { name?: string; message?: string })?.name || "Error";
          const msg = (e as { message?: string })?.message || "couldn't turn on";
          toast.error(`${name}: ${msg}`);
        }
      } else if (typeof window !== "undefined" && "Notification" in window) {
        if (Notification.permission === "denied") {
          setNotif("denied");
          toast("blocked by ur browser — allow in site settings 🔧");
        } else {
          const p = await Notification.requestPermission();
          setNotif(p as PermState);
          if (p === "granted") toast.success("notifications on 🔔");
          else if (p === "denied") toast("blocked by ur browser — allow in site settings 🔧");
          else toast("no worries — you can turn it on later");
        }
      } else {
        toast("notifications not supported on this device");
      }
    } catch {
      toast.error("couldn't turn on notifications");
    } finally { setBusy(null); }
  };

  const askLocation = () => {
    setBusy("geo");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      toast.error("location not available");
      setBusy(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => { setGeo("granted"); toast.success("location on 📍"); setBusy(null); },
      () => { setGeo("denied"); toast("no location — that's fine"); setBusy(null); },
      { timeout: 10000 },
    );
  };

  const askCamMic = async () => {
    setBusy("cam");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((t) => t.stop());
      setCam("granted");
      toast.success("camera + mic ready 📸🎤");
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      setCam("denied");
      toast(name === "NotAllowedError" ? "no worries — enable later in settings" : "couldn't access camera/mic");
    } finally { setBusy(null); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={finish} aria-hidden />
      <div className="glass relative z-10 w-full max-w-md rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">welcome ✨</div>
            <h3 className="font-display text-2xl font-bold">let's set u up 🛠</h3>
          </div>
          <button
            aria-label="Close"
            onClick={finish}
            className="press grid h-8 w-8 place-items-center rounded-full bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">turn these on so ONIQ can actually do its thing. skip whatever, no pressure.</p>

        <ul className="space-y-2">
          <PermCard
            icon={<Bell className="h-5 w-5 text-primary" />}
            title="notifications 🔔"
            desc="chats, calls, moments"
            state={notif}
            busy={busy === "notif"}
            onAsk={askNotifications}
          />
          <PermCard
            icon={<MapPin className="h-5 w-5 text-primary" />}
            title="location 📍"
            desc="rides, wander, nearby stuff"
            state={geo}
            busy={busy === "geo"}
            onAsk={askLocation}
          />
          <PermCard
            icon={<Camera className="h-5 w-5 text-primary" />}
            title="camera + mic 📸🎤"
            desc="calls, clips, QR scan"
            state={cam}
            busy={busy === "cam"}
            onAsk={askCamMic}
          />
          <PermCard
            icon={<Contact2 className="h-5 w-5 text-primary" />}
            title="contacts 📇"
            desc="find ur ppl — asked when you tap it"
            state="ondemand"
            busy={false}
            onAsk={() => { /* no blanket permission on web */ }}
          />
        </ul>

        <button
          onClick={finish}
          className="press mt-5 w-full rounded-2xl bg-primary text-primary-foreground py-3 font-semibold"
        >
          done — take me in 🚀
        </button>
        <button
          onClick={finish}
          className="press mt-2 w-full rounded-2xl bg-surface-2 py-2 text-sm text-muted-foreground"
        >
          later, I'm chillin
        </button>
      </div>
    </div>
  );
}

function PermCard({
  icon,
  title,
  desc,
  state,
  busy,
  onAsk,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  state: PermState | "ondemand";
  busy: boolean;
  onAsk: () => void;
}) {
  const isGranted = state === "granted";
  const isDenied = state === "denied";
  const isOnDemand = state === "ondemand";
  return (
    <li className="rounded-2xl bg-surface-2/60 p-3 border border-border">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-surface">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{title}</div>
          <div className="text-xs text-muted-foreground truncate">{desc}</div>
        </div>
        {isGranted ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-1 text-xs font-semibold">
            <Check className="h-3.5 w-3.5" /> on
          </span>
        ) : isOnDemand ? (
          <span className="rounded-full bg-surface px-2 py-1 text-xs text-muted-foreground">on-demand ✓</span>
        ) : (
          <button
            type="button"
            onClick={onAsk}
            disabled={busy}
            aria-busy={busy}
            className="press rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold disabled:opacity-60 min-w-[64px]"
          >
            {busy ? "…" : isDenied ? "retry" : "turn on"}
          </button>
        )}
      </div>
      {isDenied && !isGranted && (
        <div className="mt-2 text-[11px] text-amber-400/90">
          blocked by ur browser — allow in site settings 🔧
        </div>
      )}
    </li>
  );
}

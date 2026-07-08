import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ScanLine, QrCode, Camera, ClipboardPaste, AtSign } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { upiLink, isValidVpa } from "@/lib/miniapps";

export const Route = createFileRoute("/_authenticated/app/scan")({
  component: ScanScreen,
});

/** Parse a upi://pay?... string into prefill params. Returns null if not UPI. */
export function parseUpiUri(raw: string): { pa: string; pn?: string; am?: string; tn?: string } | null {
  const s = raw.trim();
  if (!/^upi:\/\/pay\?/i.test(s)) return null;
  try {
    const q = new URLSearchParams(s.slice(s.indexOf("?") + 1));
    const pa = q.get("pa")?.trim();
    if (!pa || !isValidVpa(pa)) return null;
    return {
      pa,
      pn: q.get("pn")?.trim() || undefined,
      am: q.get("am")?.trim() || undefined,
      tn: q.get("tn")?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

function ScanScreen() {
  const [tab, setTab] = useState<"scan" | "myqr">("scan");

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Scan & Pay</h1>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-1 text-sm font-semibold">
        <button
          onClick={() => setTab("scan")}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 ${tab === "scan" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          <ScanLine className="h-4 w-4" /> Scan QR
        </button>
        <button
          onClick={() => setTab("myqr")}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 ${tab === "myqr" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          <QrCode className="h-4 w-4" /> My QR
        </button>
      </div>

      {tab === "scan" ? <ScanTab /> : <MyQrTab />}
    </div>
  );
}

// ---------------- Scan & Pay ----------------

function ScanTab() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState(true);
  const [manual, setManual] = useState("");

  useEffect(() => {
    // BarcodeDetector ships in Chromium (Android Chrome/WebView) — our target.
    setSupported(typeof window !== "undefined" && "BarcodeDetector" in window);
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  function handleResult(raw: string) {
    const parsed = parseUpiUri(raw);
    if (!parsed) {
      toast.error("That QR isn't a UPI payment code");
      return;
    }
    stopCamera();
    toast.success(`Found ${parsed.pn || parsed.pa} ✅`);
    navigate({ to: "/app/upi", search: parsed });
  }

  async function startCamera() {
    if (!supported) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            handleResult(codes[0].rawValue as string);
            return;
          }
        } catch {
          /* frame not ready — keep looping */
        }
        if (streamRef.current) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      toast.error("Camera unavailable — check permissions, or paste the UPI link below");
    }
  }

  function submitManual() {
    const text = manual.trim();
    // Accept a full upi:// link OR a bare UPI ID
    const parsed = parseUpiUri(text) ?? (isValidVpa(text) ? { pa: text } : null);
    if (!parsed) {
      toast.error("Paste a upi:// link or a valid UPI ID like name@bank");
      return;
    }
    navigate({ to: "/app/upi", search: parsed });
  }

  return (
    <div className="mt-5 space-y-4">
      <div className="relative overflow-hidden rounded-3xl border border-border bg-black aspect-square">
        {/* Camera viewport */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
        />
        {!scanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-6">
            <div className="text-center">
              <Camera className="mx-auto h-10 w-10 text-white/80" />
              <p className="mt-3 text-sm text-white/80">
                {supported
                  ? "Point at any UPI QR — shop counters, PhonePe/GPay/Paytm stickers, all of them work"
                  : "Live scanning needs Android Chrome — paste the UPI link below instead"}
              </p>
              {supported && (
                <button
                  onClick={startCamera}
                  className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
                >
                  Start camera
                </button>
              )}
            </div>
          </div>
        )}
        {scanning && (
          <>
            <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80" />
            <button
              onClick={stopCamera}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white"
            >
              Stop
            </button>
          </>
        )}
      </div>

      {/* Manual fallback */}
      <div className="rounded-3xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">No camera? Paste a UPI link or ID</p>
        <div className="mt-2 flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="upi://pay?pa=…  or  name@bank"
            autoCapitalize="none"
            className="flex-1 rounded-xl border border-border bg-background px-3 py-3 text-sm focus:border-primary focus:outline-none"
          />
          <button
            onClick={submitManual}
            aria-label="Use pasted UPI details"
            className="grid h-11 w-11 place-items-center rounded-xl bg-primary text-primary-foreground"
          >
            <ClipboardPaste className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------- My QR (receive real money) ----------------

function MyQrTab() {
  const qc = useQueryClient();
  const [vpaInput, setVpaInput] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["profile-vpa"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data: pub } = await supabase
        .from("profiles")
        .select("display_name, username")
        .eq("id", u.user.id)
        .maybeSingle();
      const { data: priv } = await supabase.rpc("get_my_profile_private");
      const row = Array.isArray(priv) ? priv[0] : priv;
      return { ...(pub ?? {}), upi_vpa: row?.upi_vpa ?? null };
    },
  });


  // Render the QR whenever we have a saved VPA
  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!profile?.upi_vpa) {
        setQrDataUrl(null);
        return;
      }
      const link = upiLink({ vpa: profile.upi_vpa, name: profile.display_name || profile.username || "" });
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(link, {
        width: 480,
        margin: 2,
        color: { dark: "#0E0F13", light: "#FFFFFF" },
      });
      if (!cancelled) setQrDataUrl(url);
    }
    render().catch(() => toast.error("Couldn't render your QR"));
    return () => {
      cancelled = true;
    };
  }, [profile?.upi_vpa, profile?.display_name, profile?.username]);

  async function saveVpa() {
    if (!isValidVpa(vpaInput)) {
      toast.error("Enter a valid UPI ID like name@bank");
      return;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("profiles")
      .update({ upi_vpa: vpaInput.trim().toLowerCase() })
      .eq("id", u.user!.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("UPI ID saved — QR incoming ✨");
    qc.invalidateQueries({ queryKey: ["profile-vpa"] });
  }

  return (
    <div className="mt-5">
      {profile?.upi_vpa && qrDataUrl ? (
        <div className="rounded-3xl border border-border bg-card p-5 text-center">
          <div className="mx-auto w-64 overflow-hidden rounded-2xl bg-white p-3">
            <img data-testid="my-qr-img" src={qrDataUrl} alt="Your UPI QR code" className="h-full w-full" />
          </div>
          <div className="mt-4 font-display text-lg font-semibold">
            {profile.display_name || profile.username}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            <AtSign className="inline h-3.5 w-3.5" /> {profile.upi_vpa}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Anyone can scan this with GPay, PhonePe, Paytm or any UPI app — money lands straight in your bank. Screenshot it, print it, own it 📸
          </p>
          <button
            onClick={() => {
              setVpaInput(profile.upi_vpa ?? "");
              qc.setQueryData(["profile-vpa"], { ...profile, upi_vpa: null });
            }}
            className="mt-4 text-xs text-muted-foreground underline"
          >
            Change UPI ID
          </button>
        </div>
      ) : (
        <div className="rounded-3xl border border-border bg-card p-5">
          <h3 className="font-display text-base font-semibold">Set up your receive QR</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Enter your UPI ID once — ONIQ turns it into a scannable QR. Real money, straight to your bank; ONIQ never touches it.
          </p>
          <div className="relative mt-4">
            <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={vpaInput}
              onChange={(e) => setVpaInput(e.target.value)}
              placeholder="yourname@okhdfcbank"
              autoCapitalize="none"
              className="w-full rounded-2xl border border-border bg-background py-3 pl-10 pr-3 text-sm focus:border-primary focus:outline-none"
            />
          </div>
          <button
            onClick={saveVpa}
            disabled={saving}
            className="mt-4 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? "Saving…" : "Generate my QR"}
          </button>
        </div>
      )}
    </div>
  );
}

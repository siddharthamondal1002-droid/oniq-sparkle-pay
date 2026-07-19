import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  IndianRupee,
  Copy,
  AtSign,
  ScanLine,
  QrCode,
  Share2,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { UPI_APPS, upiLink, isValidVpa, launchUpiIntent } from "@/lib/miniapps";
import { UpiScannerOverlay } from "@/components/upi/UpiScannerOverlay";
import { supabase } from "@/integrations/supabase/client";

type UpiSearch = { pa?: string; pn?: string; am?: string; tn?: string; tab?: string };

export const Route = createFileRoute("/_authenticated/app/upi")({
  validateSearch: (search: Record<string, unknown>): UpiSearch => ({
    pa: typeof search.pa === "string" ? search.pa : undefined,
    pn: typeof search.pn === "string" ? search.pn : undefined,
    am: typeof search.am === "string" ? search.am : undefined,
    tn: typeof search.tn === "string" ? search.tn : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: UpiScreen,
});

function UpiScreen() {
  const prefill = Route.useSearch();
  const [tab, setTab] = useState<"pay" | "receive">(prefill.tab === "receive" ? "receive" : "pay");

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">UPI</h1>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-1 text-sm font-semibold">
        <button
          data-testid="upi-tab-pay"
          onClick={() => setTab("pay")}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 transition ${
            tab === "pay" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <ScanLine className="h-4 w-4" /> Scan &amp; Pay
        </button>
        <button
          data-testid="upi-tab-receive"
          onClick={() => setTab("receive")}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 transition ${
            tab === "receive" ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          }`}
        >
          <QrCode className="h-4 w-4" /> My QR
        </button>
      </div>

      {tab === "pay" ? <PayTab prefill={prefill} /> : <ReceiveTab />}
    </div>
  );
}

// ---------------- Pay tab (existing send/scan flow) ----------------

function PayTab({ prefill }: { prefill: UpiSearch }) {
  const [vpa, setVpa] = useState(prefill.pa ?? "");
  const [name, setName] = useState(prefill.pn ?? "");
  const [amount, setAmount] = useState(prefill.am ?? "");
  const [note, setNote] = useState(prefill.tn ?? "");
  const [scannerOpen, setScannerOpen] = useState(false);

  const amt = parseFloat(amount);
  const params = {
    vpa: vpa.trim(),
    name: name.trim() || vpa.trim(),
    amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
    note: note.trim() || undefined,
  };

  function validate() {
    if (!isValidVpa(vpa)) {
      toast.error("Enter a valid UPI ID like name@bank");
      return false;
    }
    if (amount && (!Number.isFinite(amt) || amt <= 0 || amt > 100000)) {
      toast.error("Enter a valid amount (or leave it blank)");
      return false;
    }
    return true;
  }

  const ready = isValidVpa(vpa) && (!amount || (Number.isFinite(amt) && amt > 0 && amt <= 100000));

  function payViaUpi() {
    if (!validate()) return;
    // Generic upi://pay intent — no package/scheme override, so Android
    // shows its native chooser of every UPI-capable app installed.
    void launchUpiIntent(upiLink(params));
  }

  async function copyLink() {
    if (!validate()) return;
    try {
      await navigator.clipboard.writeText(upiLink(params));
      toast.success("Link copied ✅ go collect");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  return (
    <>
      <p className="mt-4 text-sm text-muted-foreground">
        Real money moves through your own UPI apps. ONIQ never touches the bag — your bank handles everything, no cap.
      </p>

      <button
        type="button"
        data-testid="upi-scan"
        onClick={() => setScannerOpen(true)}
        className="press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground shadow-card"
      >
        <ScanLine className="h-5 w-5" /> Scan any QR 📷
      </button>

      {scannerOpen && (
        <UpiScannerOverlay
          onDecode={(p) => {
            setVpa(p.pa);
            if (p.pn) setName(p.pn);
            if (p.am) setAmount(p.am);
            if (p.tn) setNote(p.tn);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      <div className="mt-5 rounded-3xl border border-border bg-card p-5">
        <label className="text-xs text-muted-foreground">Recipient UPI ID</label>
        <div className="relative mt-1">
          <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={vpa}
            onChange={(e) => setVpa(e.target.value)}
            placeholder="name@okhdfcbank"
            autoCapitalize="none"
            className="w-full rounded-2xl border border-border bg-background py-3 pl-10 pr-3 text-sm focus:border-primary focus:outline-none"
          />
        </div>

        <label className="mt-4 block text-xs text-muted-foreground">Recipient name (optional)</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ravi Kumar"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
        />

        <label className="mt-4 block text-xs text-muted-foreground">Amount ₹ (optional — can enter in the app)</label>
        <div className="relative mt-1">
          <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-2xl border border-border bg-background py-3 pl-10 pr-3 text-lg font-semibold focus:border-primary focus:outline-none"
          />
        </div>

        <label className="mt-4 block text-xs text-muted-foreground">Note (optional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Rent for July"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
        />
      </div>

      <button
        type="button"
        disabled={!ready}
        data-testid="upi-pay"
        data-upi-ready={ready ? "true" : "false"}
        onClick={payViaUpi}
        className="press mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-card disabled:opacity-50"
      >
        Pay via UPI
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Android shows a chooser of every UPI app you have — GPay, PhonePe, Paytm, BHIM, your bank's app, whatever's installed.
      </p>

      <button
        onClick={copyLink}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground"
      >
        <Copy className="h-4 w-4" /> Copy UPI payment link
      </button>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Works on Android with a UPI app installed. On desktop, copy the link to your phone.
      </p>
    </>
  );
}

// ---------------- Receive tab (My QR) ----------------

function ReceiveTab() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const { data: profile, isLoading } = useQuery({
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
      return { ...(pub ?? {}), upi_vpa: (row?.upi_vpa as string | null) ?? null };
    },
  });

  const amt = parseFloat(amount);
  const amountValid = !amount || (Number.isFinite(amt) && amt > 0 && amt <= 100000);

  const receiveLink = useMemo(() => {
    if (!profile?.upi_vpa) return null;
    return upiLink({
      vpa: profile.upi_vpa,
      name: profile.display_name || profile.username || "",
      amount: amountValid && amount ? amt : undefined,
    });
  }, [profile?.upi_vpa, profile?.display_name, profile?.username, amount, amt, amountValid]);

  // Render QR whenever link changes
  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!receiveLink) {
        setQrDataUrl(null);
        return;
      }
      const QRCode = (await import("qrcode")).default;
      const url = await QRCode.toDataURL(receiveLink, {
        width: 560,
        margin: 2,
        color: { dark: "#0E0F13", light: "#FFFFFF" },
      });
      if (!cancelled) setQrDataUrl(url);
    }
    render().catch(() => toast.error("Couldn't render your QR"));
    return () => {
      cancelled = true;
    };
  }, [receiveLink]);

  async function copyVpa() {
    if (!profile?.upi_vpa) return;
    try {
      await navigator.clipboard.writeText(profile.upi_vpa);
      toast.success("UPI ID copied ✅");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  async function buildCardPng(): Promise<Blob | null> {
    if (!qrDataUrl || !profile?.upi_vpa) return null;
    const W = 900;
    const H = 1200;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // background
    ctx.fillStyle = "#0E0F13";
    ctx.fillRect(0, 0, W, H);

    // teal accent bar
    ctx.fillStyle = "#00D4B8";
    ctx.fillRect(0, 0, W, 12);

    // ONIQ wordmark
    ctx.fillStyle = "#00D4B8";
    ctx.font = "bold 56px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.textAlign = "center";
    ctx.fillText("ONIQ", W / 2, 110);

    // tagline
    ctx.fillStyle = "#8A8F9C";
    ctx.font = "500 26px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("scan to pay me on UPI", W / 2, 156);

    // white QR card
    const qrSize = 640;
    const qrX = (W - qrSize) / 2;
    const qrY = 220;
    ctx.fillStyle = "#FFFFFF";
    const r = 40;
    // rounded rect
    ctx.beginPath();
    ctx.moveTo(qrX + r, qrY);
    ctx.arcTo(qrX + qrSize, qrY, qrX + qrSize, qrY + qrSize, r);
    ctx.arcTo(qrX + qrSize, qrY + qrSize, qrX, qrY + qrSize, r);
    ctx.arcTo(qrX, qrY + qrSize, qrX, qrY, r);
    ctx.arcTo(qrX, qrY, qrX + qrSize, qrY, r);
    ctx.closePath();
    ctx.fill();

    // draw QR image
    const img = new Image();
    img.src = qrDataUrl;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    const pad = 32;
    ctx.drawImage(img, qrX + pad, qrY + pad, qrSize - pad * 2, qrSize - pad * 2);

    // name
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 44px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(profile.display_name || profile.username || "ONIQ user", W / 2, qrY + qrSize + 80);

    // VPA
    ctx.fillStyle = "#00D4B8";
    ctx.font = "600 32px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText(profile.upi_vpa, W / 2, qrY + qrSize + 130);

    // amount if any
    if (amountValid && amount) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 40px system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText(`₹ ${amt.toFixed(2)}`, W / 2, qrY + qrSize + 190);
    }

    // footer
    ctx.fillStyle = "#8A8F9C";
    ctx.font = "500 22px system-ui, -apple-system, Segoe UI, Roboto";
    ctx.fillText("GPay · PhonePe · Paytm · any UPI app", W / 2, H - 60);

    return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/png"));
  }

  async function shareQr() {
    if (!receiveLink) return;
    const blob = await buildCardPng();
    const fileName = `oniq-upi-${profile?.upi_vpa ?? "qr"}.png`;
    // Try Web Share w/ file
    try {
      if (blob && "canShare" in navigator) {
        const file = new File([blob], fileName, { type: "image/png" });
        const nav = navigator as Navigator & {
          canShare?: (data: { files?: File[] }) => boolean;
          share?: (data: { files?: File[]; title?: string; text?: string; url?: string }) => Promise<void>;
        };
        if (nav.canShare?.({ files: [file] }) && nav.share) {
          await nav.share({
            files: [file],
            title: "Pay me on UPI",
            text: `Scan to pay ${profile?.display_name || profile?.upi_vpa} on UPI`,
          });
          return;
        }
      }
      if ((navigator as Navigator & { share?: (d: unknown) => Promise<void> }).share) {
        await (navigator as Navigator & { share: (d: { title: string; text: string; url: string }) => Promise<void> }).share({
          title: "Pay me on UPI",
          text: `Scan to pay ${profile?.display_name || profile?.upi_vpa} on UPI`,
          url: receiveLink,
        });
        return;
      }
    } catch {
      /* user cancelled or share failed — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(receiveLink);
      toast.success("UPI link copied — paste it anywhere ✨");
    } catch {
      toast.error("Sharing not supported on this device");
    }
  }

  async function saveQr() {
    const blob = await buildCardPng();
    if (!blob) {
      toast.error("Couldn't build your QR card");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oniq-upi-${profile?.upi_vpa ?? "qr"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("QR saved 📥 check your downloads");
  }

  if (isLoading) {
    return (
      <div className="mt-6 rounded-3xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        Loading your QR…
      </div>
    );
  }

  // Empty state — no VPA set
  if (!profile?.upi_vpa) {
    return (
      <div className="mt-5 rounded-3xl border border-border bg-card p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <QrCode className="h-7 w-7" />
        </div>
        <h3 className="mt-4 font-display text-lg font-semibold">set up your receive QR ✨</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Add your UPI ID once — ONIQ turns it into a scannable QR. Money lands straight in your bank.
        </p>
        <Link
          to="/app/scan"
          onClick={() => {
            // Prime the ScanScreen to open on the My QR setup form
            qc.invalidateQueries({ queryKey: ["profile-vpa"] });
          }}
          className="mt-5 inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground"
        >
          Add your UPI ID
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div
        ref={cardRef}
        className="rounded-3xl border border-primary/30 bg-gradient-to-b from-card to-background p-5 text-center shadow-[0_0_0_1px_rgba(0,212,184,0.15),0_20px_60px_-30px_rgba(0,212,184,0.5)]"
      >
        <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          <span>ONIQ</span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">receive</span>
        </div>

        <div className="mx-auto mt-4 w-64 overflow-hidden rounded-2xl bg-white p-3">
          {qrDataUrl ? (
            <img
              data-testid="my-qr-img"
              src={qrDataUrl}
              alt="Your UPI QR code"
              className="h-full w-full"
            />
          ) : (
            <div className="aspect-square animate-pulse rounded-xl bg-muted" />
          )}
        </div>

        <div className="mt-4 font-display text-lg font-semibold">
          {profile.display_name || profile.username}
        </div>

        <button
          onClick={copyVpa}
          data-testid="copy-vpa"
          className="mx-auto mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
        >
          <AtSign className="h-3.5 w-3.5" /> {profile.upi_vpa}
          <Copy className="h-3.5 w-3.5" />
        </button>

        {amountValid && amount ? (
          <div className="mt-3 text-xl font-bold text-primary">₹ {amt.toFixed(2)}</div>
        ) : null}

        <p className="mt-4 text-xs text-muted-foreground">
          scannable by any UPI app — GPay, PhonePe, Paytm &amp; more
        </p>
      </div>

      <div className="rounded-3xl border border-border bg-card p-4">
        <label className="text-xs text-muted-foreground">Amount ₹ (optional)</label>
        <div className="relative mt-1">
          <IndianRupee className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              if (amount && !amountValid) toast.error("Enter a valid amount up to ₹1,00,000");
            }}
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-2xl border border-border bg-background py-3 pl-10 pr-3 text-lg font-semibold focus:border-primary focus:outline-none"
          />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Leave blank for an open QR — payer types the amount.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={shareQr}
          data-testid="share-qr"
          className="press flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          <Share2 className="h-4 w-4" /> Share QR
        </button>
        <button
          onClick={saveQr}
          data-testid="save-qr"
          className="press flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-sm font-semibold"
        >
          <Download className="h-4 w-4" /> Save QR
        </button>
      </div>
    </div>
  );
}

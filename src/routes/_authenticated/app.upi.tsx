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
import { upiLink, upiPayeeLink, isValidVpa, launchUpiIntent } from "@/lib/miniapps";
import {
  UPI_APP_LABEL,
  amendUpiUri,
  isMerchantUpiUri,
  upiAmendability,
  orderedPayApps,
  forgetUpiApp,
  readPreferredUpiApp,
  rememberUpiApp,
  retargetUpiUri,
  type UpiAppId,
} from "@/lib/upiPreference";

import { UpiIntentDiagnostic } from "@/components/upi/UpiIntentDiagnostic";
import { supabase } from "@/integrations/supabase/client";

type UpiSearch = { pa?: string; pn?: string; am?: string; tn?: string; tab?: string; raw?: string };

export const Route = createFileRoute("/_authenticated/app/upi")({
  validateSearch: (search: Record<string, unknown>): UpiSearch => ({
    pa: typeof search.pa === "string" ? search.pa : undefined,
    pn: typeof search.pn === "string" ? search.pn : undefined,
    am: typeof search.am === "string" ? search.am : undefined,
    tn: typeof search.tn === "string" ? search.tn : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
    raw:
      typeof search.raw === "string" && /^upi:\/\/pay\?/i.test(search.raw) ? search.raw : undefined,
  }),
  component: UpiScreen,
});

function UpiScreen() {
  const prefill = Route.useSearch();
  // State again — owner directive, 2026-09-06: "Make upi active again". The
  // strip below is what changes it, and `?tab=` still seeds the initial value
  // so the deep links that kept working through the hidden period still land
  // on the view they name.
  const [tab, setTab] = useState<"pay" | "receive">(
    prefill.tab === "receive" ? "receive" : "pay",
  );

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">UPI</h1>
      </div>

      {/* THE SWITCHER IS BACK — owner directive, 2026-09-06, reversing
          2026-08-17. Restored as it was rather than redesigned: same two
          testids, same labels, so `app.upi` tests and any saved deep link keep
          meaning what they meant.

          It is the only way to reach My QR. "Scan a QR instead" below already
          reaches the scanner, so the PAY direction was navigable the moment the
          Plug tile came back; RECEIVE was not reachable at all without typing
          ?tab=receive, which nobody does. That asymmetry is why this is part of
          the same change and not a nice-to-have. */}
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

      {/* Standing, low-key anti-fraud note — visible on both tabs. */}
      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Suspect fraud? Call{" "}
        <a href="tel:1930" className="font-semibold text-foreground underline">
          1930
        </a>{" "}
        or report at{" "}
        <a
          href="https://cybercrime.gov.in"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-foreground underline"
        >
          cybercrime.gov.in
        </a>
        .
      </p>

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
  const [confirming, setConfirming] = useState(false);
  const [launched, setLaunched] = useState(false);
  // Read after mount: localStorage does not exist during SSR, and a preference
  // guessed on the server would render the wrong button as primary.
  const [preferred, setPreferred] = useState<UpiAppId | null>(null);
  useEffect(() => {
    setPreferred(readPreferredUpiApp());
  }, []);

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

  // Scanned QR whose details the user hasn't edited — launch the original
  // URI untouched so merchant fields (mc/tr/sign) survive.
  const rawIntact =
    !!prefill.raw &&
    vpa.trim() === (prefill.pa ?? "") &&
    amount.trim() === (prefill.am ?? "") &&
    note.trim() === (prefill.tn ?? "");

  function payViaUpi() {
    if (!validate()) return;
    setConfirming(true);
  }

  /**
   * Open a UPI app with this payment.
   *
   * `app` null means the generic `upi://pay` intent, which every UPI app
   * answers, so Android shows its chooser. Naming an app swaps only the scheme
   * PREFIX and carries the query across untouched — that is what keeps a
   * scanned merchant QR's mc/tr/sign intact, which rebuilding the URI would
   * destroy (see rawIntact below, and upiRoundTrip.test.ts).
   *
   * Manual sends stay payee-only, though that is a mitigation and not a cure.
   * GPay and PhonePe decline PERSON-TO-PERSON payments started from any
   * third-party app whether or not an amount is pre-filled — measured
   * 2026-09-06, an amountless link still returned "declined for security
   * reasons". Merchant intents are unaffected. See upiPayeeLink in
   * miniapps.ts for the full observation, and the help panel below for what
   * to tell the person when it happens.
   *
   * The choice is REMEMBERED so the next payment skips the chooser. It is a
   * shortcut and never a lock — "Any UPI app" stays on this sheet, and if the
   * remembered app has since been uninstalled `launchUpiIntent` falls back to
   * the generic intent and clears the preference rather than stranding anyone.
   */
  /**
   * The exact string `confirmPay` would hand to the OS, computed the same way.
   * Shared with the diagnostic so what it displays cannot drift from what is
   * actually sent — a diagnostic that recomputes the payload differently is
   * worse than none.
   */
  function payloadFor(app: UpiAppId | null): string {
    const merchantScan = !!prefill.raw && isMerchantUpiUri(prefill.raw);
    const base = rawIntact
      ? prefill.raw!
      : merchantScan
        ? amendUpiUri(prefill.raw!, { am: amount, tn: note })
        : upiPayeeLink(params);
    return retargetUpiUri(base, app);
  }

  function confirmPay(app: UpiAppId | null) {
    setConfirming(false);
    setLaunched(true);
    if (app) rememberUpiApp(app);
    else forgetUpiApp();
    setPreferred(app);
    // WHICH BYTES GO TO THE BANK, and getting this wrong costs a real payment.
    //
    //   untouched scan          -> the scanned URI, verbatim
    //   MERCHANT scan, edited   -> the scanned URI with am/tn AMENDED, so
    //                              mc/tr/mode/orgid/sign survive
    //   anything else           -> payee-only, no amount
    //
    // The middle case is the one that was broken. A collection QR carries no
    // amount, so typing one flipped rawIntact false and dropped the whole
    // merchant identity — the banks then saw a P2P payment to a current
    // account and refused it as "not allowed on the receiver's account type".
    // See amendUpiUri in upiPreference.ts for the measured case.
    // A SIGNED QR CANNOT CARRY AN AMOUNT WE ADD. `sign` covers the payload it
    // was issued for and only the merchant's PSP can re-sign, so appending `am`
    // would hand the app a signature that no longer matches — which is what a
    // PSP refuses "for security reasons". Launch it exactly as scanned and SAY
    // SO, rather than dropping the typed amount silently.
    const signedImmutable =
      !!prefill.raw && upiAmendability(prefill.raw) === "signed-immutable";
    if (signedImmutable && amount.trim() && amount.trim() !== (prefill.am ?? "")) {
      toast("Enter ₹" + amount.trim() + " in your UPI app — this QR has a fixed, signed payload", {
        duration: 7000,
      });
    }
    void launchUpiIntent(payloadFor(app));
  }

  async function copyLink() {
    if (!validate()) return;
    try {
      await navigator.clipboard.writeText(rawIntact ? prefill.raw! : upiLink(params));
      toast.success("Link copied ✅ opens in any UPI app");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  async function copyVpaOnly() {
    if (!isValidVpa(vpa)) {
      toast.error("Enter a valid UPI ID like name@bank");
      return;
    }
    try {
      await navigator.clipboard.writeText(vpa.trim());
      toast.success("UPI ID copied — paste it in PhonePe, GPay or any UPI app");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  return (
    <>
      <p className="mt-4 text-sm text-muted-foreground">
        Real money moves through your own UPI apps. ONIQ never touches the bag — your bank handles
        everything, no cap.
      </p>

      <Link
        to="/app/scan"
        className="press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card p-3 text-sm font-semibold"
      >
        <ScanLine className="h-4 w-4" /> Scan a QR instead 📷
      </Link>

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

        <label className="mt-4 block text-xs text-muted-foreground">
          Recipient name (optional)
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ravi Kumar"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
        />

        <label className="mt-4 block text-xs text-muted-foreground">
          Amount ₹ (optional — can enter in the app)
        </label>
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

      {/* Payee + amount restated at the moment of action, away from the form fields. */}
      <div
        data-testid="upi-confirm-line"
        className="mt-5 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-center text-sm"
      >
        <span className="text-muted-foreground">You're sending </span>
        <span className="font-bold text-foreground">
          {params.amount ? `₹${params.amount.toFixed(2)}` : "an amount you'll enter in the app"}
        </span>
        <span className="text-muted-foreground"> to </span>
        <span className="font-bold text-foreground">{params.name || vpa.trim() || "—"}</span>
      </div>

      <button
        type="button"
        disabled={!ready}
        data-testid="upi-pay"
        data-upi-ready={ready ? "true" : "false"}
        onClick={payViaUpi}
        className="press mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground shadow-card disabled:opacity-50"
      >
        Pay via UPI
      </button>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        UPI PIN is never needed to receive money. Never enter your PIN for a "refund", "cashback",
        or "₹1 verification" request.
      </p>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Android shows a chooser of every UPI app you have — GPay, PhonePe, Paytm, BHIM, your bank's
        app, whatever's installed.
      </p>

      {prefill.raw ? (
        <UpiIntentDiagnostic raw={prefill.raw} finalUri={payloadFor(preferred)} />
      ) : null}

      {launched && (
        <div
          data-testid="upi-declined-help"
          className="mt-4 rounded-2xl border border-amber-500/40 bg-card p-4 text-xs text-muted-foreground"
        >
          <p className="text-sm font-semibold text-foreground">
            declined "for security reasons"? 🛡️
          </p>
          <p className="mt-1.5">
            GPay &amp; PhonePe block person-to-person payments started from other apps — an
            anti-fraud rule on their side, not a problem with your bank or this payee. This way
            always works:
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>
              tap <span className="font-semibold text-foreground">Copy UPI ID</span> below
            </li>
            <li>
              open GPay / PhonePe yourself →{" "}
              <span className="font-semibold text-foreground">"Pay to UPI ID"</span>
            </li>
            <li>paste, enter the amount, pay ✅</li>
          </ol>
          <button
            type="button"
            onClick={copyVpaOnly}
            className="press mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 font-semibold text-primary-foreground"
          >
            <AtSign className="h-3.5 w-3.5" /> Copy UPI ID
          </button>
          <p className="mt-2 text-[11px]">
            Shop QRs scanned with ONIQ and your own receive QR are unaffected — this only hits
            person-to-person sends handed to another app.
          </p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={copyVpaOnly}
          data-testid="copy-upi-id"
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground"
        >
          <AtSign className="h-4 w-4" /> Copy UPI ID
        </button>
        <button
          onClick={copyLink}
          className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground"
        >
          <Copy className="h-4 w-4" /> Copy payment link
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Payment declined "for security reasons"? Copy the UPI ID and pay directly inside your UPI
        app.
      </p>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Works on Android with a UPI app installed. On desktop, copy the link to your phone.
      </p>

      {/* Deliberate friction: one confirm step restating payee VPA, name and
          amount before the hand-off to the UPI app. */}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-8"
          onClick={() => setConfirming(false)}
        >
          <div
            data-testid="upi-confirm-sheet"
            className="w-full max-w-md rounded-3xl border border-border bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-bold">you're SENDING money 💸</h3>
            <div className="mt-3 rounded-2xl border border-border bg-background p-4 text-center">
              <div className="text-base font-semibold">{params.name}</div>
              <div className="mt-0.5 break-all text-sm text-muted-foreground">{params.vpa}</div>
              <div className="mt-2 text-2xl font-bold text-primary">
                {params.amount ? `₹ ${params.amount.toFixed(2)}` : "amount entered in your UPI app"}
              </div>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
              {!rawIntact && params.amount && (
                <li>
                  • your UPI app will ask you to type the amount — enter ₹{params.amount.toFixed(2)}{" "}
                  there
                </li>
              )}
              {!rawIntact && (
                <li>
                  • if it declines "for security reasons": GPay &amp; PhonePe block sends started
                  from other apps — copy the UPI ID instead and pay inside your app
                </li>
              )}
              <li>• double-check the name and UPI ID above match who you meant to pay</li>
              <li>• your UPI PIN is only ever needed to SEND money — never to receive it</li>
              <li>• "pay ₹1 to verify", refund and cashback requests are scams</li>
            </ul>
            {/* THE APP LIST IS THE ONLY WAY TO LEARN A PREFERENCE. Android
                gives no callback saying which app its chooser picked, so the
                person has to name it. Their last choice leads and carries the
                testid the tests pin. */}
            <div className="mt-4 flex flex-col gap-2">
              {orderedPayApps(preferred).map((id, i) => (
                <button
                  key={id}
                  type="button"
                  data-testid={i === 0 ? "upi-confirm-send" : `upi-confirm-${id}`}
                  onClick={() => confirmPay(id)}
                  className={`press rounded-2xl py-3 text-sm font-semibold ${
                    i === 0
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-background"
                  }`}
                >
                  Pay with {UPI_APP_LABEL[id]}
                  {preferred === id ? " · last used" : ""}
                </button>
              ))}
              <button
                type="button"
                data-testid="upi-confirm-any"
                onClick={() => confirmPay(null)}
                className="press rounded-2xl border border-border bg-background py-3 text-sm font-semibold"
              >
                Any UPI app
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="press rounded-2xl py-3 text-sm font-semibold text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------- Receive tab (My QR) ----------------

function ReceiveTab() {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [vpaInput, setVpaInput] = useState("");
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  async function saveVpa() {
    if (!isValidVpa(vpaInput)) {
      toast.error("Enter a valid UPI ID like name@bank");
      return;
    }
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setSaving(false);
      toast.error("Please sign in again");
      return;
    }
    const { error } = await supabase
      .from("profiles_private")
      .upsert(
        { user_id: u.user.id, upi_vpa: vpaInput.trim().toLowerCase() },
        { onConflict: "user_id" },
      );
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("UPI ID saved — QR incoming ✨");
    qc.invalidateQueries({ queryKey: ["profile-vpa"] });
  }

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

  // Push-payment QR only: the payer scans and pushes money to this VPA.
  // Collect/"request money" requests are intentionally absent — NPCI banned P2P
  // UPI collect requests from 1 Oct 2025. Do not reintroduce one here.
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
          share?: (data: {
            files?: File[];
            title?: string;
            text?: string;
            url?: string;
          }) => Promise<void>;
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
        await (
          navigator as Navigator & {
            share: (d: { title: string; text: string; url: string }) => Promise<void>;
          }
        ).share({
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

  // Empty state — no VPA set; set it up right here.
  if (!profile?.upi_vpa) {
    return (
      <div className="mt-5 rounded-3xl border border-border bg-card p-6 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <QrCode className="h-7 w-7" />
        </div>
        <h3 className="mt-4 font-display text-lg font-semibold">set up your receive QR ✨</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your UPI ID once — ONIQ turns it into a scannable QR. Money lands straight in your
          bank; ONIQ never touches it.
        </p>
        <div className="relative mt-4 text-left">
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
          className="press mt-4 w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {saving ? "Saving…" : "Generate my QR"}
        </button>
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
        <p className="mt-2 text-xs text-muted-foreground">
          receiving money never needs your UPI PIN — anyone who asks for it to "receive" a payment
          is scamming you 🚩
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, IndianRupee, Copy, AtSign, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { UPI_APPS, upiLink, isValidVpa } from "@/lib/miniapps";
import { UpiScannerOverlay } from "@/components/upi/UpiScannerOverlay";

type UpiSearch = { pa?: string; pn?: string; am?: string; tn?: string };

export const Route = createFileRoute("/_authenticated/app/upi")({
  validateSearch: (search: Record<string, unknown>): UpiSearch => ({
    pa: typeof search.pa === "string" ? search.pa : undefined,
    pn: typeof search.pn === "string" ? search.pn : undefined,
    am: typeof search.am === "string" ? search.am : undefined,
    tn: typeof search.tn === "string" ? search.tn : undefined,
  }),
  component: UpiScreen,
});

function UpiScreen() {
  const prefill = Route.useSearch();
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

  function guard(e: React.MouseEvent) {
    if (!validate()) e.preventDefault();
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
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Pay via UPI</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
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

      <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
        send it with
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {UPI_APPS.map((app) => (
          <a
            key={app.id}
            href={ready ? app.scheme(params) : "#"}
            data-testid={`upi-${app.id}`}
            data-upi-ready={ready ? "true" : "false"}
            onClick={guard}
            className="rounded-2xl border border-border bg-card p-4 text-center text-sm font-semibold transition hover:border-primary/40"
            style={{ color: app.color }}
          >
            {app.name}
          </a>
        ))}
      </div>

      <button
        onClick={copyLink}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground"
      >
        <Copy className="h-4 w-4" /> Copy UPI payment link
      </button>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Works on Android with a UPI app installed. On desktop, copy the link to your phone.
      </p>
    </div>
  );
}

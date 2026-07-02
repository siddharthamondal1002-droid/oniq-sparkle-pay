import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowUpRight, Send, Plus, QrCode, Gift, ArrowDownLeft, ArrowUpRight as Out, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/pay")({
  component: PayScreen,
});

function PayScreen() {
  const qc = useQueryClient();
  const [showSend, setShowSend] = useState(false);

  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("wallets").select("fiat_balance, omiq_balance")
        .eq("user_id", u.user.id).maybeSingle();
      return data;
    },
  });

  const { data: txns } = useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("transactions").select("*")
        .or(`sender_id.eq.${u.user.id},recipient_id.eq.${u.user.id}`)
        .order("created_at", { ascending: false }).limit(20);
      return (data ?? []).map((t) => ({ ...t, isIncoming: t.recipient_id === u.user!.id }));
    },
  });

  return (
    <div className="px-5 pt-12 pb-6">
      <h1 className="font-display text-3xl font-bold">ONIQ Pay</h1>

      <div className="mt-4 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-accent to-primary p-5 text-primary-foreground shadow-card glow-cyan">
        <div className="text-xs opacity-80">the bag 💰</div>
        <div className="mt-1 font-display text-4xl font-bold">
          ${Number(wallet?.fiat_balance ?? 0).toFixed(2)}
        </div>
        <div className="mt-1 text-xs opacity-80">
          + {Number(wallet?.omiq_balance ?? 0).toFixed(2)} OMIQ
        </div>
        <div className="mt-5 grid grid-cols-4 gap-2 text-center text-[10px]">
          <PayAction icon={Send} label="Send" onClick={() => setShowSend(true)} />
          <PayAction
            icon={Plus}
            label="Top up"
            onClick={async () => {
              const { data, error } = await supabase.rpc("demo_top_up", { _amount: 100 });
              if (error) {
                toast.error(error.message);
                return;
              }
              toast.success(`+$100 secured 📈 balance $${Number(data).toFixed(2)} — we are so back`);
              qc.invalidateQueries({ queryKey: ["wallet"] });
              qc.invalidateQueries({ queryKey: ["transactions"] });
            }}
          />
          <PayAction icon={QrCode} label="Scan" onClick={() => toast.info("Scan coming soon")} />
          <PayAction icon={Gift} label="Red packet" onClick={() => toast.info("Red packet coming soon")} />
        </div>
      </div>

      <Link
        to="/app/wallet"
        className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-card p-4"
      >
        <div>
          <div className="font-display text-sm font-semibold">OMIQ Crypto Wallet</div>
          <div className="text-xs text-muted-foreground">ERC-20 on Polygon · Your keys</div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
        Recent activity
      </h2>
      <div className="mt-3 space-y-2">
        {txns && txns.length > 0 ? (
          txns.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
              <div className={`grid h-10 w-10 place-items-center rounded-full ${t.isIncoming ? "bg-primary/15 text-primary" : "bg-accent/15 text-accent"}`}>
                {t.isIncoming ? <ArrowDownLeft className="h-4 w-4" /> : <Out className="h-4 w-4" />}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium capitalize">{t.type.replace(/_/g, " ")}</div>
                <div className="text-xs text-muted-foreground">
                  {t.note ? `${t.note} · ` : ""}
                  {formatDistanceToNow(new Date(t.created_at ?? Date.now()), { addSuffix: true })}
                </div>
              </div>
              <div className={`text-sm font-semibold ${t.isIncoming ? "text-primary" : ""}`}>
                {t.isIncoming ? "+" : "-"}${Number(t.amount).toFixed(2)}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Zero transactions… lowkey embarrassing. Tap Send and start your era 💅
          </div>
        )}
      </div>

      {showSend && (
        <SendMoneySheet
          onClose={() => setShowSend(false)}
          onDone={() => {
            setShowSend(false);
            qc.invalidateQueries({ queryKey: ["wallet"] });
            qc.invalidateQueries({ queryKey: ["transactions"] });
          }}
        />
      )}
    </div>
  );
}

function PayAction({ icon: Icon, label, onClick }: { icon: typeof Send; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl bg-background/15 py-2.5 backdrop-blur transition hover:bg-background/25">
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function SendMoneySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const amt = parseFloat(amount);
    if (!username.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Need a username and a real amount, bestie");
      return;
    }
    if (amt > 10000) {
      toast.error("Demo cap is $10k — delulu is not the solulu");
      return;
    }
    setSending(true);
    const { error } = await supabase.rpc("send_payment", {
      _recipient_username: username.trim().toLowerCase(),
      _amount: amt,
      _note: note.trim() || undefined,
    });
    setSending(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Sent $${amt.toFixed(2)} to @${username} 💸 no cap`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Send money</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="text-xs text-muted-foreground">Recipient username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="alice"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="mt-4 block text-xs text-muted-foreground">Amount (USD)</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number" inputMode="decimal" placeholder="0.00"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="mt-4 block text-xs text-muted-foreground">Note (optional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Dinner"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          onClick={submit}
          disabled={sending}
          className="mt-5 w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send it 💸"}
        </button>
      </div>
    </div>
  );
}

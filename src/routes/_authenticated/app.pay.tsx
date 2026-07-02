import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowUpRight,
  Send,
  Plus,
  QrCode,
  HandCoins,
  ArrowDownLeft,
  ArrowUpRight as Out,
  X,
  Check,
  Gift,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/pay")({
  component: PayScreen,
});

type RedPacket = {
  id: string;
  amount: number;
  greeting: string;
  created_at: string;
  sender: { display_name: string | null; username: string | null } | null;
};

function PayScreen() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showSend, setShowSend] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [showPacket, setShowPacket] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const { data: requests } = useQuery({
    queryKey: ["payment-requests"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("payment_requests")
        .select("id, amount, note, created_at, requester:profiles!payment_requests_requester_id_fkey(display_name, username)")
        .eq("payer_id", u.user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: packets } = useQuery<RedPacket[]>({
    queryKey: ["red-packets-inbox"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("red_packets")
        .select("id, amount, greeting, created_at, sender:profiles!red_packets_sender_id_fkey(display_name, username)")
        .eq("recipient_id", u.user.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      return (data ?? []) as unknown as RedPacket[];
    },
  });

  async function respond(id: string, accept: boolean) {
    const { data, error } = await supabase.rpc("respond_payment_request", {
      _request_id: id,
      _accept: accept,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(data === "paid" ? "Paid ✅ they're eating good tonight" : "Request declined");
    qc.invalidateQueries({ queryKey: ["payment-requests"] });
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }

  async function openPacket(id: string) {
    setOpeningId(id);
    const { data, error } = await supabase.rpc("open_red_packet", { _packet_id: id });
    setOpeningId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`+$${Number(data).toFixed(2)} unlocked 🧧 good fortune fr`);
    qc.invalidateQueries({ queryKey: ["red-packets-inbox"] });
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  }

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
        <div className="mt-5 grid grid-cols-5 gap-2 text-center text-[10px]">
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
          <PayAction icon={QrCode} label="Scan" onClick={() => navigate({ to: "/app/scan" })} />
          <PayAction icon={HandCoins} label="Request" onClick={() => setShowRequest(true)} />
          <PayAction icon={Gift} label="Packet" onClick={() => setShowPacket(true)} />
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

      <Link
        to="/app/banks"
        data-testid="banks-link"
        className="mt-2 flex items-center justify-between rounded-2xl border border-border bg-card p-4"
      >
        <div>
          <div className="font-display text-sm font-semibold">Linked banks</div>
          <div className="text-xs text-muted-foreground">Add accounts · withdraw the bag 🏦</div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {packets && packets.length > 0 && (
        <>
          <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
            Red packets for you 🧧
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {packets.map((p) => (
              <button
                key={p.id}
                data-testid="red-packet"
                onClick={() => openPacket(p.id)}
                disabled={openingId === p.id}
                className="group relative overflow-hidden rounded-2xl border border-amber/40 bg-gradient-to-b from-[#c8102e] to-[#8a0a1f] p-4 text-left text-white shadow-card transition active:scale-[0.98] disabled:opacity-70"
              >
                <div className="absolute -right-4 -top-4 h-16 w-16 rounded-full bg-amber/20 blur-2xl" />
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-80">
                  <Gift className="h-3 w-3" /> Sealed
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-medium">{p.greeting}</div>
                <div className="mt-3 text-[11px] opacity-80">
                  from @{p.sender?.username ?? "someone"}
                </div>
                <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[11px] font-semibold backdrop-blur">
                  {openingId === p.id ? "Opening…" : "Tap to open"}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {requests && requests.length > 0 && (
        <>
          <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
            They want the bag 👀
          </h2>
          <div className="mt-3 space-y-2">
            {requests.map((r) => (
              <div key={r.id} data-testid="payment-request" className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-card p-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">
                    {(r.requester as { display_name?: string; username?: string } | null)?.display_name ?? "Someone"} requests ${Number(r.amount).toFixed(2)}
                  </div>
                  {r.note && <div className="text-xs text-muted-foreground">{r.note}</div>}
                </div>
                <button
                  onClick={() => respond(r.id, false)}
                  aria-label="Decline request"
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-background"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  onClick={() => respond(r.id, true)}
                  aria-label="Pay request"
                  className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground"
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

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

      {showRequest && (
        <RequestMoneySheet
          onClose={() => setShowRequest(false)}
          onDone={() => {
            setShowRequest(false);
            qc.invalidateQueries({ queryKey: ["payment-requests"] });
          }}
        />
      )}

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

      {showPacket && (
        <RedPacketSheet
          onClose={() => setShowPacket(false)}
          onDone={() => {
            setShowPacket(false);
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

function RequestMoneySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const amt = parseFloat(amount);
    if (!username.trim() || !Number.isFinite(amt) || amt <= 0 || amt > 10000) {
      toast.error("Need a username and an amount up to $10k, bestie");
      return;
    }
    setSending(true);
    const { error } = await supabase.rpc("create_payment_request", {
      _from_username: username.trim().toLowerCase(),
      _amount: Math.round(amt * 100) / 100,
      _note: note.trim() || undefined,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Requested $${amt.toFixed(2)} from @${username} — manifesting 🤲`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Request money</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="text-xs text-muted-foreground">From username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="alice"
          autoCapitalize="none"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="mt-4 block text-xs text-muted-foreground">Amount (USD)</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number" inputMode="decimal" placeholder="0.00"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="mt-4 block text-xs text-muted-foreground">What's it for? (optional)</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Pizza night 🍕"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          onClick={submit}
          disabled={sending}
          data-testid="send-request"
          className="mt-5 w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {sending ? "Requesting…" : "Request it 🤲"}
        </button>
      </div>
    </div>
  );
}

function RedPacketSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [amount, setAmount] = useState("");
  const [greeting, setGreeting] = useState("");
  const [sending, setSending] = useState(false);

  async function submit() {
    const amt = parseFloat(amount);
    if (!username.trim() || !Number.isFinite(amt) || amt <= 0 || amt > 10000) {
      toast.error("Need a username and an amount up to $10k");
      return;
    }
    setSending(true);
    const { error } = await supabase.rpc("send_red_packet", {
      _to_username: username.trim().toLowerCase(),
      _amount: Math.round(amt * 100) / 100,
      _greeting: greeting.trim() || undefined,
    });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Red packet sealed for @${username} 🧧 $${amt.toFixed(2)} escrowed`);
    onDone();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Send a red packet 🧧</h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-4 rounded-2xl border border-amber/40 bg-gradient-to-br from-[#c8102e] to-[#8a0a1f] p-4 text-white">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-80">
            <Gift className="h-3 w-3" /> Escrow · reclaim after 24h
          </div>
          <div className="mt-2 text-sm font-medium">
            {greeting.trim() || "Good fortune! 🧧"}
          </div>
        </div>
        <label className="text-xs text-muted-foreground">To username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="sid"
          autoCapitalize="none"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="mt-4 block text-xs text-muted-foreground">Amount (USD)</label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          type="number" inputMode="decimal" placeholder="0.00"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <label className="mt-4 block text-xs text-muted-foreground">Greeting (optional)</label>
        <input
          value={greeting}
          onChange={(e) => setGreeting(e.target.value)}
          maxLength={80}
          placeholder="for the chai ☕"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          onClick={submit}
          disabled={sending}
          data-testid="send-packet"
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-[#c8102e] to-amber py-3 font-semibold text-white disabled:opacity-50"
        >
          {sending ? "Sealing…" : "Seal & send 🧧"}
        </button>
      </div>
    </div>
  );
}

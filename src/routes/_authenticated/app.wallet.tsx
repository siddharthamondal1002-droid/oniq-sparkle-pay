import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, Coins, Send, QrCode } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/wallet")({
  component: WalletScreen,
});

function WalletScreen() {
  const { data: wallet } = useQuery({
    queryKey: ["wallet"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("wallets")
        .select("*")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return data;
    },
  });

  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">OMIQ Wallet</h1>
      </div>

      <div className="mt-5 overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-amber to-magenta p-6 text-primary-foreground shadow-card glow-magenta">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest opacity-80">
          <Coins className="h-4 w-4" /> OMIQ Token
        </div>
        <div className="mt-4 font-display text-5xl font-bold">
          {Number(wallet?.omiq_balance ?? 0).toFixed(2)}
        </div>
        <div className="mt-1 text-xs opacity-80">
          ≈ ${(Number(wallet?.omiq_balance ?? 0) * 0.42).toFixed(2)} USD
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
          <button className="flex flex-col items-center gap-1 rounded-2xl bg-background/15 py-2.5 backdrop-blur">
            <ArrowDownLeft className="h-4 w-4" /> Receive
          </button>
          <button className="flex flex-col items-center gap-1 rounded-2xl bg-background/15 py-2.5 backdrop-blur">
            <Send className="h-4 w-4" /> Send
          </button>
          <button className="flex flex-col items-center gap-1 rounded-2xl bg-background/15 py-2.5 backdrop-blur">
            <QrCode className="h-4 w-4" /> Scan
          </button>
        </div>
      </div>

      <div className="mt-5 rounded-3xl border border-border bg-card p-5">
        <div className="text-xs text-muted-foreground">Wallet address</div>
        <div className="mt-2 font-mono text-sm break-all">
          0x{(wallet?.user_id ?? "0000000000000000000000000000000000000000").replace(/-/g, "").slice(0, 40)}
        </div>
        <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs text-primary">
          Polygon · ERC-20
        </div>
      </div>

      <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
        Why OMIQ?
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <ArrowUpRight className="mt-0.5 h-4 w-4 text-primary" />
          Earn OMIQ for posting, paying, and referring friends.
        </li>
        <li className="flex items-start gap-2">
          <ArrowUpRight className="mt-0.5 h-4 w-4 text-primary" />
          Spend OMIQ in food, mini-apps, and creator tipping.
        </li>
        <li className="flex items-start gap-2">
          <ArrowUpRight className="mt-0.5 h-4 w-4 text-primary" />
          Withdraw to any Polygon address. Your keys, your coins.
        </li>
      </ul>
    </div>
  );
}

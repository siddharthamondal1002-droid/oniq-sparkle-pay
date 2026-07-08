import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sparkles,
  Coins,
  Send,
  Car,
  LayoutGrid,
  IndianRupee,
  Lock,
  Clapperboard,
  GraduationCap,
  Plane,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/")({
  component: HomeScreen,
});

function HomeScreen() {
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("profiles")
        .select("display_name, username, avatar_url")
        .eq("id", u.user.id)
        .maybeSingle();
      return data;
    },
  });


  const first = profile?.display_name?.split(" ")[0] ?? profile?.username ?? "there";

  return (
    <div className="bg-hero pb-6 min-h-screen">
      <h1 className="sr-only">Your ONIQ dashboard</h1>
      <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground">main character detected ✨</div>
            {profileLoading ? (
              <div className="mt-1 h-8 w-40 animate-pulse rounded-lg bg-surface" />
            ) : (
              <p className="font-display text-3xl font-bold">yo, {first} 👋</p>
            )}
          </div>

          <Link
            to="/app/profile"
            aria-label="Open profile"
            className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground font-bold overflow-hidden"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
            ) : (
              (profile?.display_name ?? profile?.username ?? "O").charAt(0).toUpperCase()
            )}
          </Link>
        </div>

        {/* Wallet card */}
        <Link
          to="/app/pay"
          className="mt-4 block overflow-hidden rounded-2xl bg-primary p-5 text-primary-foreground shadow-card"
        >
          <div className="flex items-center justify-between text-xs opacity-80">
            ONIQ Pay balance <ArrowUpRight className="h-4 w-4" />
          </div>
          <div className="mt-3 font-display text-4xl font-bold">
            {Number(wallet?.fiat_balance ?? 0).toLocaleString()}
            <span className="text-lg ml-1 opacity-70">credits</span>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Action label="Send" icon={Send} />
            <Action label="Top up" icon={Plus} />
            <Action label="Wallet" icon={Wallet} />
          </div>
        </Link>

        {/* 2x4 service tiles */}
        <h2 className="mt-7 px-1 font-display text-xs uppercase tracking-wider text-muted-foreground">
          the lineup
        </h2>
        <div className="mt-3 grid grid-cols-4 gap-3">
          <Tile to="/app/travel" icon={Plane} label="Wander" />
          <Tile to="/app/pay" icon={Wallet} label="Pay" />
          <Tile to="/app/wallet" icon={Coins} label="Wallet" />
          <Tile to="/app/ai" icon={Sparkles} label="Ting" />
          
          <Tile to="/app/rides" icon={Car} label="Rides" />
          <Tile to="/app/miniapps" icon={LayoutGrid} label="Mini Apps" />
          <Tile to="/app/upi" icon={IndianRupee} label="UPI Pay" />
          <Tile to="/app/clips" icon={Clapperboard} label="Clips" />
          <Tile to="/app/learn" icon={GraduationCap} label="Learn" />
          
        </div>
      </div>
    </div>
  );
}

function Action({ label, icon: Icon }: { label: string; icon: typeof Send }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-2xl bg-background/15 py-2.5 text-xs backdrop-blur">
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}

function Tile({
  to,
  icon: Icon,
  label,
  locked = false,
}: {
  to?: string;
  icon: typeof Send;
  label: string;
  locked?: boolean;
}) {
  const inner = (
    <>
      <div className="relative grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
        {locked && (
          <div className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-surface-2 border border-border">
            <Lock className="h-2.5 w-2.5 text-muted-foreground" />
          </div>
        )}
      </div>
      <span className={`text-[11px] font-medium ${locked ? "text-muted-foreground" : ""}`}>{label}</span>
    </>
  );
  const base =
    "flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl bg-card p-2 border border-border";
  if (locked) {
    return <div className={`${base} opacity-60`}>{inner}</div>;
  }
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} className={`${base} hover:bg-surface-2 transition-colors`}>
      {inner}
    </Link>
  );
}

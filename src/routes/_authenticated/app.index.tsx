import { useState } from "react";
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
  Newspaper,
} from "lucide-react";
import { CompactLiveNews } from "@/components/landing/LiveNewsSection";
import {
  CustomizeButton,
  useUserTheme,
  type TileKey,
} from "@/components/customize/CustomizeSheet";

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

  const { data: theme } = useUserTheme();
  const skins = theme?.tile_skins ?? {};
  const wallpaper = theme?.wallpaper_url ?? null;

  const first = profile?.display_name?.split(" ")[0] ?? profile?.username ?? "there";

  return (
    <div className="relative bg-hero pb-6 min-h-screen">
      {wallpaper && (
        <div className="pointer-events-none fixed inset-0 -z-0">
          <img
            src={wallpaper}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => ((e.currentTarget.style.display = "none"))}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/75 to-background/85 backdrop-blur-[2px]" />
        </div>
      )}
      <div className="relative z-10">
        <h1 className="sr-only">Your ONIQ dashboard</h1>
        <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between fade-up">
            <div>
              <div className="text-xs text-muted-foreground">main character detected ✨</div>
              {profileLoading ? (
                <div className="mt-1 h-8 w-40 animate-pulse rounded-lg bg-surface" />
              ) : (
                <p className="font-display text-3xl font-bold text-gradient-primary">yo, {first} 👋</p>
              )}
            </div>

            <Link
              to="/app/profile"
              aria-label="Open profile"
              className="press grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground font-bold overflow-hidden"
            >
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="h-full w-full object-cover" />
              ) : (
                (profile?.display_name ?? profile?.username ?? "O").charAt(0).toUpperCase()
              )}
            </Link>
          </div>

          <CompactLiveNews />

          <div className="mt-7 px-1 flex items-center justify-between">
            <h2 className="font-display text-xs uppercase tracking-wider text-muted-foreground">
              the lineup
            </h2>
            <CustomizeButton />
          </div>
          <div className="mt-3 grid grid-cols-4 auto-rows-[5.25rem] gap-3">
            <HeroTile
              tileKey="pulse"
              skin={skins.pulse}
              to="/app/news"
              icon={Newspaper}
              label="Pulse"
              tagline="what's happening"
              gradient="from-primary/30 via-primary/10 to-accent/30"
              delay={0}
            />
            <HeroTile
              tileKey="clips"
              skin={skins.clips}
              to="/app/clips"
              icon={Clapperboard}
              label="Clips"
              tagline="watch the feed"
              gradient="from-accent/30 via-fuchsia-500/20 to-pink-500/30"
              delay={60}
            />
            {(
              [
                { key: "wallet", to: "/app/wallet", icon: Coins, label: "Wallet", color: "#F59E0B" },
                { key: "ting", to: "/app/ai", icon: Sparkles, label: "Ting", color: "#8B5CF6" },
                { key: "rides", to: "/app/rides", icon: Car, label: "Rides", color: "#38BDF8" },
                { key: "miniapps", to: "/app/miniapps", icon: LayoutGrid, label: "Mini Apps", color: "#A3E635" },
                { key: "upi", to: "/app/upi", icon: IndianRupee, label: "UPI Pay", color: "#22C55E" },
                { key: "learn", to: "/app/learn", icon: GraduationCap, label: "Learn", color: "#FB923C" },
                { key: "wander", to: "/app/travel", icon: Plane, label: "Wander", color: "#22D3EE" },
              ] as const
            ).map((t, i) => (
              <Tile
                key={t.label}
                to={t.to}
                icon={t.icon}
                label={t.label}
                color={t.color}
                skin={skins[t.key as TileKey]}
                delay={120 + i * 40}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({
  to,
  icon: Icon,
  label,
  color,
  skin,
  locked = false,
  delay = 0,
}: {
  to?: string;
  icon: typeof Send;
  label: string;
  color?: string;
  skin?: string;
  locked?: boolean;
  delay?: number;
}) {
  const [skinError, setSkinError] = useState(false);
  const showSkin = skin && !skinError;
  const tint = color ?? "#00D4B8";
  const inner = (
    <>
      <div
        className="relative grid h-11 w-11 place-items-center rounded-2xl overflow-hidden"
        style={
          showSkin
            ? undefined
            : { color: tint, background: `${tint}1A` }
        }
      >
        {showSkin ? (
          <img
            src={skin!}
            alt=""
            className="h-11 w-11 rounded-2xl object-cover"
            onError={() => setSkinError(true)}
          />
        ) : (
          <Icon className="h-5 w-5" />
        )}
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
    "press fade-up flex flex-col items-center justify-center gap-2 rounded-2xl bg-card p-2 border border-border";
  const style = { animationDelay: `${delay}ms` };
  if (locked) {
    return <div className={`${base} opacity-60`} style={style}>{inner}</div>;
  }
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link to={to as any} className={`${base} hover:bg-surface-2 transition-colors`} style={style}>
      {inner}
    </Link>
  );
}

function HeroTile({
  to,
  icon: Icon,
  label,
  tagline,
  gradient,
  skin,
  delay = 0,
}: {
  tileKey: TileKey;
  to: string;
  icon: typeof Send;
  label: string;
  tagline: string;
  gradient: string;
  skin?: string;
  delay?: number;
}) {
  const [skinError, setSkinError] = useState(false);
  const showSkin = skin && !skinError;
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Link
      to={to as any}
      style={{ animationDelay: `${delay}ms` }}
      className={`press fade-up col-span-2 row-span-2 relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br ${gradient} p-4 flex flex-col justify-between`}
    >
      {showSkin ? (
        <img
          src={skin!}
          alt=""
          className="h-10 w-10 rounded-xl object-cover"
          onError={() => setSkinError(true)}
        />
      ) : (
        <Icon className="h-10 w-10 text-foreground/90" strokeWidth={1.6} />
      )}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{tagline}</div>
        <div className="font-display text-2xl font-bold">{label}</div>
      </div>
    </Link>
  );
}

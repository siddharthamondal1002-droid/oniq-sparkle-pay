import { moneyIn } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Star, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/app/food/")({
  component: FoodScreen,
});

function FoodScreen() {
  const {
    data: restaurants,
    isError: restaurantsError,
    refetch: refetchRestaurants,
  } = useQuery({
    queryKey: ["restaurants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        // Project only the columns the card renders. The old select-star also
        // pulled the unbounded description and address text (plus review_count /
        // created_at) that this list never shows — dead payload on every food
        // page load. is_open and rating stay usable in the filter/order without
        // being selected. (The full row is fetched on the restaurant detail
        // route, app.food.$id.)
        .select("id, name, cuisine_type, image_url, rating, delivery_time_mins, delivery_fee")
        .eq("is_open", true)
        .order("rating", { ascending: false });
      // Throw so a failed read shows a retry, not an empty restaurant list.
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="pb-6">
      <div className="bg-hero px-5 pt-12">
        <div className="flex items-center gap-3">
          <Link
            to="/app"
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card/40"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="text-xs text-muted-foreground">Delivering to</div>
            <div className="text-sm font-semibold">Your location · 12 min</div>
          </div>
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">Eat well, fast.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Alcohol-free menus, family-safe by default.
        </p>
      </div>

      <div className="mt-5 px-5 space-y-3">
        {restaurantsError && (
          <div className="rounded-2xl border border-border bg-card p-4 text-sm">
            <p className="text-muted-foreground">
              Couldn't load restaurants right now — a connection problem, not an empty menu.
            </p>
            <button
              type="button"
              onClick={() => refetchRestaurants()}
              className="press mt-2 rounded-full border border-border px-3 py-1.5 text-xs font-medium"
            >
              Try again
            </button>
          </div>
        )}
        {restaurants?.map((r) => (
          <Link
            key={r.id}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            to={"/app/food/$id" as any}
            params={{ id: r.id } as any}
            className="block overflow-hidden rounded-3xl border border-border bg-card"
          >
            {r.image_url && (
              <div
                className="h-40 w-full bg-cover bg-center"
                style={{ backgroundImage: `url(${r.image_url})` }}
              />
            )}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-display text-lg font-semibold">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.cuisine_type}</div>
                </div>
                <div className="flex items-center gap-1 rounded-full bg-amber/15 px-2 py-0.5 text-xs text-amber">
                  <Star className="h-3 w-3 fill-current" />
                  {Number(r.rating).toFixed(1)}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {r.delivery_time_mins} min
                </span>
                <span>·</span>
                <span>{moneyIn(Number(r.delivery_fee), "USD")} delivery</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { moneyIn } from "@/lib/format";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Plus, Minus, Star, Clock, Leaf, ShoppingBag, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/food/$id")({
  component: RestaurantPage,
});

type Cart = Record<string, number>; // menu_item_id -> qty

function RestaurantPage() {
  const { id } = Route.useParams();
  const [cart, setCart] = useState<Cart>({});
  const [showCheckout, setShowCheckout] = useState(false);

  const { data: restaurant } = useQuery({
    queryKey: ["restaurant", id],
    queryFn: async () => {
      const { data } = await supabase.from("restaurants").select("*").eq("id", id).maybeSingle();
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["menu", id],
    queryFn: async () => {
      const { data } = await supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", id)
        .order("category");
      return data ?? [];
    },
  });

  const cartCount = useMemo(() => Object.values(cart).reduce((a, b) => a + b, 0), [cart]);
  const subtotal = useMemo(() => {
    if (!items) return 0;
    return items.reduce((sum, it) => sum + (cart[it.id] ?? 0) * Number(it.price), 0);
  }, [cart, items]);

  function add(itemId: string) {
    setCart((c) => ({ ...c, [itemId]: Math.min(20, (c[itemId] ?? 0) + 1) }));
  }
  function remove(itemId: string) {
    setCart((c) => {
      const next = { ...c };
      const q = (next[itemId] ?? 0) - 1;
      if (q <= 0) delete next[itemId];
      else next[itemId] = q;
      return next;
    });
  }

  if (!restaurant) {
    return (
      <div className="space-y-3 p-5 pt-12">
        <div className="h-56 animate-pulse rounded-3xl bg-card" />
        <div className="h-24 animate-pulse rounded-3xl bg-card" />
      </div>
    );
  }

  return (
    <div className="pb-32">
      {restaurant.image_url && (
        <div
          className="relative h-56 w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${restaurant.image_url})` }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
          <Link
            to="/app/food"
            className="absolute left-4 top-10 grid h-9 w-9 place-items-center rounded-full border border-border bg-card/70 backdrop-blur"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div className="-mt-10 px-5">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
          <h1 className="font-display text-2xl font-bold">{restaurant.name}</h1>
          <div className="mt-1 text-sm text-muted-foreground">{restaurant.description}</div>
          <div className="mt-3 flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber/15 px-2 py-1 text-amber">
              <Star className="h-3 w-3 fill-current" />
              {Number(restaurant.rating).toFixed(1)} ({restaurant.review_count})
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" /> {restaurant.delivery_time_mins} min
            </span>
          </div>
        </div>

        <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
          Menu
        </h2>
        <div className="mt-3 space-y-3">
          {items?.map((it) => {
            const qty = cart[it.id] ?? 0;
            return (
              <div key={it.id} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
                {it.image_url && (
                  <div
                    className="h-20 w-20 shrink-0 rounded-xl bg-cover bg-center"
                    style={{ backgroundImage: `url(${it.image_url})` }}
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {it.name}
                    {it.is_vegetarian && <Leaf className="h-3 w-3 text-neon" />}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {it.description}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-sm font-semibold">{moneyIn(Number(it.price), "USD")}</div>
                    {qty === 0 ? (
                      <button
                        onClick={() => add(it.id)}
                        aria-label={`Add ${it.name} to cart`}
                        className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => remove(it.id)}
                          aria-label={`Remove one ${it.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-5 text-center text-sm font-semibold">{qty}</span>
                        <button
                          onClick={() => add(it.id)}
                          aria-label={`Add one more ${it.name}`}
                          className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Sticky cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-40 mx-auto max-w-md px-5">
          <button
            onClick={() => setShowCheckout(true)}
            data-testid="checkout-bar"
            aria-label="Open checkout"
            className="flex w-full items-center justify-between rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-card"
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" /> {cartCount} item{cartCount > 1 ? "s" : ""}
            </span>
            <span>
              {moneyIn(subtotal + Number(restaurant.delivery_fee ?? 0), "USD")} · Checkout
            </span>
          </button>
        </div>
      )}

      {showCheckout && (
        <CheckoutSheet
          restaurantId={id}
          cart={cart}
          items={items ?? []}
          subtotal={subtotal}
          deliveryFee={Number(restaurant.delivery_fee ?? 0)}
          onClose={() => setShowCheckout(false)}
          onDone={() => {
            setCart({});
            setShowCheckout(false);
          }}
        />
      )}
    </div>
  );
}

function CheckoutSheet({
  restaurantId,
  cart,
  items,
  subtotal,
  deliveryFee,
  onClose,
  onDone,
}: {
  restaurantId: string;
  cart: Cart;
  items: Array<{ id: string; name: string; price: number }>;
  subtotal: number;
  deliveryFee: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [address, setAddress] = useState("");
  const [placing, setPlacing] = useState(false);
  const total = subtotal + deliveryFee;
  const lines = items.filter((it) => cart[it.id]);

  async function placeOrder() {
    if (address.trim().length < 5) {
      toast.error("Enter a delivery address");
      return;
    }
    setPlacing(true);
    const { data, error } = await supabase.rpc("place_order", {
      _restaurant_id: restaurantId,
      _items: Object.entries(cart).map(([menu_item_id, qty]) => ({ menu_item_id, qty })),
      _delivery_address: address.trim(),
    });
    setPlacing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Order locked in 🔥 chef is cooking fr");
    onDone();
    void data;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl border-t border-border bg-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Your order</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-40 space-y-2 overflow-y-auto">
          {lines.map((it) => (
            <div key={it.id} className="flex justify-between text-sm">
              <span>
                {cart[it.id]}× {it.name}
              </span>
              <span className="font-medium">{moneyIn(cart[it.id] * Number(it.price), "USD")}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{moneyIn(subtotal, "USD")}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Delivery</span>
            <span>{moneyIn(deliveryFee, "USD")}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Total</span>
            <span>{moneyIn(total, "USD")}</span>
          </div>
        </div>

        <label className="mt-4 block text-xs text-muted-foreground">Delivery address</label>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="221B Baker Street, Apt 4"
          className="mt-1 w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        <button
          onClick={placeOrder}
          disabled={placing}
          data-testid="place-order"
          className="mt-5 w-full rounded-2xl bg-primary py-3 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {placing ? "Placing order…" : `Pay ${moneyIn(total, "USD")}`}
        </button>
      </div>
    </div>
  );
}

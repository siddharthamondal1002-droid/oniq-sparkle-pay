
# ONIQ audited patch — apply verbatim in 4 steps

I will apply your pasted code exactly as given. No refactors, renames, restyles, or "improvements". I will not touch `src/integrations/*`, auth, chat, discover, or AI screens. `src/routeTree.gen.ts` stays auto-generated.

## Step 1 — DB migration (single migration)

Run the SQL you paste as one migration via the Supabase migration tool. Covers:
- `wallets.fiat_balance` default → 1000.00, backfill zero balances, insert `reward` "Welcome demo credits" ledger row per wallet.
- `handle_new_user()` (SECURITY DEFINER, `SET search_path = public`) funds new wallets + welcome ledger.
- `demo_top_up(_amount numeric)` plpgsql SECURITY DEFINER, caps `_amount ≤ 500`, resulting balance `≤ 10000`; `GRANT EXECUTE TO authenticated`.
- `DROP POLICY "transactions_insert_own"` + `REVOKE INSERT ON public.transactions FROM authenticated`.
- `bump_comment_count()` + AFTER INSERT OR DELETE trigger on `moments_comments`, plus backfill UPDATE.
- `send_payment(...)` with deterministic wallet lock order (lower `user_id` first), hard cap `_amount ≤ 10000`.
- `place_order(_restaurant_id, _items jsonb, _delivery_address)` returns uuid — server reads prices from `menu_items`, qty 1–20, ≤30 lines, rejects `contains_alcohol` and `is_available = false`, locks buyer wallet FOR UPDATE, deducts subtotal + `restaurants.delivery_fee`, inserts `orders` (confirmed/paid/oniq_pay) and `order_payment` transaction with `order_id` in metadata; `GRANT EXECUTE TO authenticated`; `REVOKE UPDATE ON public.orders FROM authenticated`.

Verify: migration applies cleanly, no policy/grant errors.

## Step 2 — New files (verbatim paste)

- `src/lib/miniapps.ts` — `MINI_APPS` (15 partners), `openInApp` with dynamic `/* @vite-ignore */` `@capacitor/browser` import + `window.open` fallback, `openDeepLink`, `upiLink` + `UPI_APPS` (tez/phonepe/paytmmp) with `am` gated on `Number.isFinite(amount) && amount > 0 && amount <= 100000`, `isValidVpa`, `uberLink`/`olaLink` throwing on non-finite coords, `geocode()` against nominatim filtering non-finite lat/lon.
- `src/lib/weather.functions.ts` — `createServerFn({ method: "POST" })` + `requireSupabaseAuth`, OpenWeatherMap current + 5d/3h collapsed to daily min/max, reads `process.env.OPENWEATHER_API_KEY` inside `.handler()`, returns `{ configured: false }` when missing.
- `src/routes/_authenticated/app.miniapps.tsx` — `/_authenticated/app/miniapps`, category-grouped grid calling `openInApp`.
- `src/routes/_authenticated/app.rides.tsx` — `/_authenticated/app/rides`, Nominatim search, Uber universal link (pickup=my_location, dropoff lat/lon/nickname), Ola/Rapido via `openInApp`.
- `src/routes/_authenticated/app.upi.tsx` — `/_authenticated/app/upi`, form + validation, 4 pay buttons from `UPI_APPS`, clipboard fallback.

Verify: build compiles, route tree regenerates.

## Step 3 — Full-file replacements (verbatim paste)

- `src/routes/_authenticated/app.weather.tsx` — geolocation inside `useEffect(..., [])`, city-search fallback, skeleton, unconfigured-key empty state.
- `src/routes/_authenticated/app.food.$id.tsx` — cart `Record<menuItemId, qty>`, +/- capped at 20, sticky checkout bar, `CheckoutSheet` → `supabase.rpc("place_order")`, invalidates `["wallet"]` and `["transactions"]`.
- `src/routes/_authenticated/app.pay.tsx` — Top up → `supabase.rpc("demo_top_up", { _amount: 100 })`; `SendMoneySheet` validates `Number.isFinite(amt) && amt > 0 && amt <= 10000` before `supabase.rpc("send_payment")`.
- `src/routes/_authenticated/app.index.tsx` — unlock Rides (Car → `/app/rides`), Mini Apps (LayoutGrid → `/app/miniapps`), UPI Pay (IndianRupee → `/app/upi`); remove locked Scan/More tiles.

Verify: build compiles after each replacement; no `useState` for geolocation.

## Step 4 — Dependency

Add `"@capacitor/browser": "^8.0.0"` to `package.json` dependencies via `bun add @capacitor/browser@^8.0.0`.

## Post-apply acceptance checks

I will verify against your acceptance list: fresh signup $1000 + welcome txn, top-up +$100, $50 send updates both sides, food checkout deducts server-computed total, comment count trigger, `/app/rides` Uber URL shape, `/app/upi` `upi://pay` intent, weather graceful unconfigured state.

## What I need from you

1. Paste Step 1 SQL. I apply it and confirm.
2. Then paste Step 2 files (all 5). I create them and confirm build.
3. Then paste Step 3 files (all 4). I replace them and confirm build.
4. I add the dep and run acceptance checks.

One question before we start: do you also want me to add `OPENWEATHER_API_KEY` as a project secret now (via `add_secret`) so the weather route returns real data, or leave it unset so it renders the "not configured" empty state for this pass?

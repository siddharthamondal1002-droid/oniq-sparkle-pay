-- BUYING A PLAN, AND TWO BIGGER TIERS.
--
-- OWNER DIRECTIVE, 2026-08-16, taken against costed options:
--
--   * ONIQ Plus 25 — Rs 1,499 for 25 minutes a month.
--   * ONIQ Plus 60 — Rs 3,499 for 60 minutes a month.
--
-- WHY THESE NUMBERS AND NOT THE Rs 499 RATE EXTENDED. Rs 499 for 8 minutes is
-- Rs 62.38 per included minute, which is ABOVE the Rs 57/min top-up rate — the
-- plan is really selling the watermark and the lenses, and the minutes come
-- along. At 25 and 60 minutes that bundle does not scale, so the minutes have
-- to carry the price on their own; extended at Rs 62.38 the tiers would have
-- cost Rs 1,559 and Rs 3,743, both MORE than simply topping up the same
-- minutes, which is not a product. Rs 1,499 and Rs 3,499 are Rs 60 and Rs 58
-- per minute — a small volume discount that still nets 17.3% and 15.4% with
-- the allowance fully used. maxIncludedSecondsFor() bounds both and a test
-- sweeps EVERY paid plan against it, because a guard naming only plus_monthly
-- would have waved these two straight through.
--
-- THE CHECKOUT ITSELF is the seconds rail again, with one more product on it:
-- the row exists before the Razorpay order so a payment can always be
-- attributed, the price is read off subscription_plans rather than off the
-- request, and settlement happens by provider order id from both the webhook
-- and the client verify. `kind: 'plan_month'` is the discriminator.
--
-- THE ONE RULE THIS FILE EXISTS TO ENFORCE: creating an order grants nothing.
-- create_plan_purchase records an INTENT. credit_plan_purchase — reachable by
-- the service role only — is the sole caller of grant_subscription, and it
-- runs only once money has moved.
--
-- THE OWNER CAN NOW SEE PRICES. Riding free meant story_quota_status returned
-- purchaseEnabled false, so the one person who needs to test checkout was the
-- one person who could not see it. admin_prefs.show_purchase_surfaces turns
-- the surfaces on for an admin WITHOUT charging them — claim_story_seconds
-- still debits nothing. Off by default, so a screen-share never shows the
-- owner being sold to.

insert into public.subscription_plans
  (key, label, kind, billing_period, price_paise, included_seconds, entitlements, active, sort_order)
values
  ('plus_25', 'ONIQ Plus 25', 'auto_renew', 'P1M', 149900, 1500,
   '{no_watermark,all_lenses,group_calls}', true, 11),
  ('plus_60', 'ONIQ Plus 60', 'auto_renew', 'P1M', 349900, 3600,
   '{no_watermark,all_lenses,group_calls}', true, 12)
on conflict (key) do update
  set label = excluded.label, price_paise = excluded.price_paise,
      included_seconds = excluded.included_seconds, entitlements = excluded.entitlements,
      active = excluded.active, sort_order = excluded.sort_order;

create table if not exists public.admin_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  show_purchase_surfaces boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.admin_prefs enable row level security;
drop policy if exists admin_prefs_read_own on public.admin_prefs;
create policy admin_prefs_read_own on public.admin_prefs for select using (auth.uid() = user_id);

create table if not exists public.plan_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_key text not null references public.subscription_plans(key),
  months int not null default 1 check (months between 1 and 12),
  price_paise int not null check (price_paise > 0),
  currency text not null default 'INR',
  status text not null default 'created'
    check (status in ('created','paid','failed','refunded')),
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text,
  origin text not null default 'web',
  error text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists plan_purchases_user_idx on public.plan_purchases (user_id, created_at desc);
alter table public.plan_purchases enable row level security;
drop policy if exists plan_purchases_read_own on public.plan_purchases;
create policy plan_purchases_read_own on public.plan_purchases for select using (auth.uid() = user_id);

-- Functions applied to the live project in the same change; bodies are the
-- ones running there. See the header for the rule each of them enforces.
--   create_plan_purchase(text, text)          -> authenticated  (intent only)
--   attach_plan_purchase_order(uuid, text)    -> service role
--   credit_plan_purchase(text, text, text)    -> service role   (grants)
--   fail_plan_purchase(text, text)            -> service role
--   set_show_purchase_surfaces(boolean)       -> authenticated, admin-checked
-- A paid row is never walked back by a late payment.failed event: Razorpay can
-- send one for an attempt on an order a later attempt paid, and marking that
-- failed would strip a plan somebody holds a receipt for.

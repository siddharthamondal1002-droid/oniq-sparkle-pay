-- Razorpay: paying for an order that already exists, at a price ONIQ decided.
--
-- WHY THIS SLOTS IN WHERE IT DOES. `place_order` already reads every line
-- item's price FROM menu_items and computes subtotal + delivery_fee itself —
-- the client never sends an amount and never could. Razorpay is therefore
-- bolted to an ORDER ID, not to a number: the payment is for order X, and what
-- order X costs is a column. A checkout that took an amount from the browser
-- would be the whole class of "pay one rupee for a hundred-rupee meal" bug, and
-- this design cannot express it.
--
-- PHYSICAL GOODS ONLY, and that is a compliance boundary rather than a
-- preference. Google Play permits a third-party processor for real-world goods
-- and services — food delivery is the documented example — and REQUIRES Play
-- Billing for digital content consumed in the app. So this may pay for a meal.
-- It must never be wired to Story seconds, an AI tier, or unlocking a feature.
-- `payments.order_id` is NOT NULL against `orders` specifically so that
-- attaching it to something digital would need a schema change, and a schema
-- change is visible.
--
-- ONIQ HELD NO MONEY BEFORE THIS. The in-app wallet was decommissioned in
-- 20260728201524 and UPI is a deep link into the user's own app. This is a
-- deliberate reversal of that, decided by the project owner, and it is scoped
-- as narrowly as the decision allows: no balance, no stored value, no
-- person-to-person transfer. Money moves once, for one order, and ONIQ records
-- that it happened.

-- ---------------------------------------------------------------------------
-- Configuration. One row, flippable without a deploy — same shape as
-- story_config and video_gen_config, and for the same reason: a payment path
-- needs an off switch that works at 2am.
--
-- It ships ENABLED, which is what was asked for. The switch exists for the
-- morning somebody needs it, not as a soft launch.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_config (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  -- Razorpay settles in INR. Storing it rather than assuming it means a second
  -- currency is a data change and not a hunt through the code.
  currency text not null default 'INR' check (currency = upper(currency)),
  -- Bounds in the smallest unit, so there is no floating point anywhere near a
  -- price. 100 paise is Razorpay's own floor; the ceiling is ours, and it is
  -- the only line that stops one order becoming a large one.
  min_amount_minor bigint not null default 100 check (min_amount_minor > 0),
  max_amount_minor bigint not null default 5000000 check (max_amount_minor > 0),
  updated_at timestamptz not null default now(),
  constraint payment_config_bounds check (max_amount_minor >= min_amount_minor)
);
insert into public.payment_config (id) values (true) on conflict (id) do nothing;

alter table public.payment_config enable row level security;
grant all on public.payment_config to service_role;
-- Readable by a signed-in user so the checkout screen can say "payments are
-- paused" instead of failing at the button. Nothing sensitive is in here.
grant select on public.payment_config to authenticated;
create policy "payment_config_select" on public.payment_config
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- One row per payment attempt.
--
-- A LEDGER OF ATTEMPTS, not a balance. Every row is an attempt to pay for one
-- order, and the terminal states are `paid`, `failed` and `refunded`. There is
-- no sum over this table that anybody is allowed to spend.
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- NOT NULL and against `orders`: see the note at the top. A payment always
  -- has a real-world thing being bought.
  order_id uuid not null references public.orders(id) on delete cascade,
  provider text not null default 'razorpay' check (provider in ('razorpay')),
  -- UNIQUE is the idempotency key. The browser callback and the webhook race
  -- each other by design — whichever arrives first wins and the other is a
  -- no-op — and a retried webhook must not pay for the same meal twice.
  provider_order_id text not null unique,
  provider_payment_id text unique,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR',
  status text not null default 'created'
    check (status in ('created', 'paid', 'failed', 'refunded')),
  -- Which side confirmed it. The webhook is the trustworthy one; the browser is
  -- convenient. Recording it means a dispute can be answered.
  confirmed_by text check (confirmed_by is null or confirmed_by in ('client', 'webhook')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_order_idx on public.payments (order_id);

alter table public.payments enable row level security;
grant all on public.payments to service_role;
grant select on public.payments to authenticated;

-- Users read their own attempts and write NOTHING. Every insert and every
-- status change happens in an edge function that has verified a signature —
-- there is no client-writable path to "paid" at all.
create policy "payments_select_own" on public.payments
  for select to authenticated using (user_id = auth.uid());

-- Belt and braces on the orders table itself. RLS already has no UPDATE policy
-- for authenticated, so an update is refused, but the GRANT from the original
-- schema is still there and a future policy could make it live. Payment status
-- is not the client's to write under any circumstances.
revoke update on public.orders from authenticated;

-- ---------------------------------------------------------------------------
-- Marking an order paid. SERVICE ROLE ONLY.
--
-- Not callable by a user, not callable by anon. The only callers are
-- razorpay-verify (after checking the HMAC of order_id|payment_id) and
-- razorpay-webhook (after checking the HMAC of the raw request body). A
-- SECURITY DEFINER function that `authenticated` could execute would be a
-- button marked "mark my order paid".
--
-- IDEMPOTENT, because it is called twice by design. The browser comes back with
-- a signature at the same time Razorpay posts a webhook, and Razorpay retries
-- webhooks. Second and later calls report what already happened and change
-- nothing.
-- ---------------------------------------------------------------------------
create or replace function public.mark_order_paid(
  _provider_order_id text,
  _provider_payment_id text,
  _confirmed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments%rowtype;
begin
  if _confirmed_by not in ('client', 'webhook') then
    raise exception 'mark_order_paid: confirmed_by must be client or webhook';
  end if;

  -- Lock the attempt so two confirmations arriving together serialise here
  -- rather than both reading `created` and both writing `paid`.
  select * into pay from public.payments
  where provider_order_id = _provider_order_id
  for update;

  if pay.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no such payment');
  end if;

  if pay.status = 'paid' then
    -- Already done. Report which side got there first; do not touch anything.
    return jsonb_build_object(
      'ok', true, 'already', true,
      'orderId', pay.order_id, 'confirmedBy', pay.confirmed_by
    );
  end if;

  if pay.status <> 'created' then
    return jsonb_build_object('ok', false, 'reason', 'payment is ' || pay.status);
  end if;

  update public.payments
     set status = 'paid',
         provider_payment_id = coalesce(_provider_payment_id, provider_payment_id),
         confirmed_by = _confirmed_by,
         updated_at = now()
   where id = pay.id;

  update public.orders
     set payment_status = 'paid',
         payment_method = 'razorpay'
   where id = pay.order_id;

  return jsonb_build_object('ok', true, 'already', false, 'orderId', pay.order_id);
end;
$$;

revoke all on function public.mark_order_paid(text, text, text) from public, anon, authenticated;

-- Recording a failure is separate, because a failure must never be able to
-- reach the paid branch by passing a different argument.
create or replace function public.mark_payment_failed(
  _provider_order_id text,
  _error text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payments
     set status = case when status = 'paid' then status else 'failed' end,
         error = left(coalesce(_error, 'payment failed'), 500),
         updated_at = now()
   where provider_order_id = _provider_order_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_payment_failed(text, text) from public, anon, authenticated;

comment on table public.payments is
  'One row per Razorpay payment attempt against one order. Physical goods only '
  '(Play requires Play Billing for digital content). No balance, no stored '
  'value, no person-to-person transfer.';

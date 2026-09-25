-- ONIQ payment operations recovery — cycle 1. NOT APPLIED.
--
-- Reviewable SQL, deliberately outside supabase/migrations/: that directory's
-- tool APPLIES what it writes, and this cycle is code and tests only.
--
-- THE GAP. `razorpay-webhook` answers a retryable non-2xx when a handled event
-- could not be processed. Once Razorpay stops retrying, a captured payment
-- nobody granted is gone and nothing records that it happened. Delivery is the
-- provider's promise; durability has to be ours.
--
--   1. delivered, not processed  -> public.payment_webhook_events
--   2. never delivered           -> public.payment_reconcile_cursor
--   3. money going back out      -> public.payment_cases (+ immutable events)
--
-- NOTHING HERE MOVES MONEY. No refund, capture, clawback or payout. A refund or
-- dispute opens a CASE; the policy decision is recorded as outstanding.
--
-- STORED: identifiers, event name, minor amount, provider status, timestamps,
-- and a SHA-256 of the verified bytes. NOT the payload — it carries email,
-- contact, card fingerprint, VPA and our notes, and none of it is evidence.
--
-- NO SCHEDULE IS CREATED. `payment_recovery_setup_schedule()` exists and is not
-- called: a cron job pointing at a worker that is not deployed, with a
-- credential nobody has tested, is a job that fails every two minutes.

-- ---------------------------------------------------------------------------
-- 1. THE INBOX.
--
--    TWO UNIQUE INDEXES, NOT ONE COMPOSITE KEY. A single `dedup_key` fails the
--    case it exists for: the same body delivered once with an event-id header
--    and once without produces two different keys and is processed twice. So
--    the BODY DIGEST is unique on its own — a redelivery of identical bytes
--    collides however it is labelled — and the PROVIDER EVENT ID is unique on
--    its own, so one delivery identity can never describe two bodies.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_webhook_events (
  id                   uuid        primary key default gen_random_uuid(),
  provider_event_id    text,
  body_sha256          text        not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  event_name           text        not null check (length(event_name) <= 64),
  event_class          text        not null
                         check (event_class in ('paid','failed','refund','dispute','other')),
  provider_order_id    text,
  provider_payment_id  text,
  provider_refund_id   text,
  provider_dispute_id  text,
  amount_minor         bigint      check (amount_minor is null or amount_minor >= 0),
  provider_status      text,
  provider_created_at  timestamptz,
  state                text        not null default 'pending'
                         check (state in ('pending','processing','done','ignored',
                                          'exhausted','conflict')),
  attempts             integer     not null default 0 check (attempts >= 0),
  next_due_at          timestamptz not null default now(),
  lease_token          uuid,
  lease_expires_at     timestamptz,
  last_error           text,
  -- The body we first saw under this event id, kept when a second body claims
  -- the same id. It is the conflict's only evidence.
  conflict_sha256      text,
  received_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists payment_webhook_events_body
  on public.payment_webhook_events (body_sha256);
create unique index if not exists payment_webhook_events_event_id
  on public.payment_webhook_events (provider_event_id) where provider_event_id is not null;
create index if not exists payment_webhook_events_due
  on public.payment_webhook_events (next_due_at) where state in ('pending','processing');
create index if not exists payment_webhook_events_order
  on public.payment_webhook_events (provider_order_id) where provider_order_id is not null;

alter table public.payment_webhook_events enable row level security;

-- The one place the retry bound is written down. SQL enforces it; no caller
-- may raise it by passing a bigger number.
create or replace function public.payment_recovery_max_attempts()
returns integer language sql immutable as $function$ select 12 $function$;

-- 1b. EVERY DELIVERY IDENTITY WE HAVE EVER SEEN, and which body it named.
--
--     A single nullable column on the event row could only remember the FIRST
--     id a body arrived under. So a body first seen headerless, then delivered
--     again under `E2`, then a DIFFERENT body delivered under `E2`, looked like
--     an ordinary new event: the crossed pair was never detectable because the
--     alias was never written down. The mapping is its own table, and it is
--     what the conflict check reads.
create table if not exists public.payment_webhook_event_ids (
  provider_event_id text        primary key
                      check (provider_event_id ~ '^[A-Za-z0-9_-]{6,80}$'),
  event_row_id      uuid        not null
                      references public.payment_webhook_events(id) on delete cascade,
  body_sha256       text        not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  first_seen_at     timestamptz not null default now()
);
create index if not exists payment_webhook_event_ids_row
  on public.payment_webhook_event_ids (event_row_id);
alter table public.payment_webhook_event_ids enable row level security;

-- ---------------------------------------------------------------------------
-- 2. THE RECONCILER'S CURSOR. Separate from the five purchase tables: those
--    belong to the order-creation path, which this cycle does not touch.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_reconcile_cursor (
  purchase_table    text        not null,
  provider_order_id text        not null,
  user_id           uuid,
  state             text        not null default 'pending'
                      check (state in ('pending','processing','resolved','exhausted','skipped')),
  attempts          integer     not null default 0 check (attempts >= 0),
  next_due_at       timestamptz not null default now(),
  lease_token       uuid,
  lease_expires_at  timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (purchase_table, provider_order_id)
);

-- BY DUE TIME, NOT BY AGE: ordering by creation would let the oldest
-- unresolvable rows monopolise every batch and starve this minute's purchase.
create index if not exists payment_reconcile_cursor_due
  on public.payment_reconcile_cursor (next_due_at) where state in ('pending','processing');

alter table public.payment_reconcile_cursor enable row level security;

-- ---------------------------------------------------------------------------
-- 3. CASES, and an APPEND-ONLY history beside them.
--
--    The case row is the current position; the history is what happened. A
--    resolution that can be overwritten is not an audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_cases (
  id                  uuid        primary key default gen_random_uuid(),
  case_type           text        not null
                        check (case_type in ('refund','dispute','manual_review')),
  provider_case_id    text,
  provider_order_id   text,
  provider_payment_id text,
  purchase_table      text,
  user_id             uuid,
  amount_minor        bigint      check (amount_minor is null or amount_minor >= 0),
  -- An amount with no currency is not a sum of money. A screen showing "4900"
  -- beside a rupee sign it inferred is how a ₹49 refund is read as ₹4,900.
  currency            text        check (currency is null or currency ~ '^[A-Za-z]{3}$'),
  current_event       text,
  current_rank        integer     not null default -1,
  -- WHAT THE EVENT STREAM SAYS, AND WHAT A FRESH READ SAID, ARE TWO FACTS.
  -- `current_event` is the last delivery; these two are the last time anyone
  -- actually ASKED the provider. A cycling dispute is only readable from the
  -- second, and a case with none must show as unverified rather than as agreed.
  provider_status_verified    text,
  provider_status_verified_at timestamptz,
  status              text        not null default 'open'
                        check (status in ('open','resolved','needs_provider_refresh')),
  open_reason         text        not null default 'policy-decision-outstanding',
  resolution          text        check (resolution in ('no_action','entitlement_revoked',
                                                        'refund_acknowledged','duplicate','other')),
  resolution_note     text,
  resolved_by         uuid,
  resolved_at         timestamptz,
  reopened_count      integer     not null default 0,
  opened_at           timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists payment_cases_provider_case
  on public.payment_cases (provider_case_id) where provider_case_id is not null;
create unique index if not exists payment_cases_manual_per_order
  on public.payment_cases (provider_order_id)
  where case_type = 'manual_review' and provider_order_id is not null;
create index if not exists payment_cases_open_first
  on public.payment_cases (status, updated_at desc);

alter table public.payment_cases enable row level security;

create table if not exists public.payment_case_events (
  id          bigserial   primary key,
  case_id     uuid        not null references public.payment_cases(id) on delete cascade,
  kind        text        not null check (kind in ('opened','advanced','stale','conflict',
                                                   'reopened','resolved','linked',
                                                   'linkage_refused','provider_refreshed')),
  event_name  text,
  rank        integer,
  detail      jsonb       not null default '{}'::jsonb,
  actor       uuid,
  created_at  timestamptz not null default now()
);
create index if not exists payment_case_events_case on public.payment_case_events (case_id, id);
alter table public.payment_case_events enable row level security;

-- APPEND-ONLY BY TRIGGER, not by GRANT: a grant stops a client and not the
-- table owner, and a security-definer function runs as the owner.
create or replace function public.payment_case_events_immutable()
returns trigger language plpgsql as $function$
begin
  raise exception 'payment_case_events is append-only';
end;
$function$;
drop trigger if exists payment_case_events_no_change on public.payment_case_events;
create trigger payment_case_events_no_change
  before update or delete on public.payment_case_events
  for each row execute function public.payment_case_events_immutable();

-- ---------------------------------------------------------------------------
-- 4. ACL. Nothing is granted by default and nothing should be: a client that
--    could write here could manufacture evidence of a payment.
-- ---------------------------------------------------------------------------
revoke all on public.payment_webhook_events    from public, anon, authenticated;
revoke all on public.payment_webhook_event_ids from public, anon, authenticated;
revoke all on public.payment_reconcile_cursor  from public, anon, authenticated;
revoke all on public.payment_cases             from public, anon, authenticated;
revoke all on public.payment_case_events       from public, anon, authenticated;

grant select, insert, update on public.payment_webhook_events    to service_role;
-- The alias mapping is written once per delivery identity and never edited:
-- an UPDATE here would be re-pointing an id at another body, which is the very
-- thing the table exists to make impossible.
grant select, insert         on public.payment_webhook_event_ids to service_role;
grant select, insert, update on public.payment_reconcile_cursor  to service_role;
grant select, insert, update on public.payment_cases             to service_role;
grant select, insert         on public.payment_case_events       to service_role;

-- RLS is on with NO policy for anon/authenticated on any of the four. There is
-- no direct client read path; admins go through the RPC, which re-derives the
-- check server-side.

-- ---------------------------------------------------------------------------
-- 5. ALERTS. Reuses the watchdog's ledger and its dedup convention: one open
--    row per signal, refreshed rather than duplicated.
--
--    `notified_at` IS NOT SET HERE. Opening an alert is not delivering one, and
--    writing a delivery timestamp we have no evidence for is how an outage
--    becomes something nobody was ever told about.
-- ---------------------------------------------------------------------------
create or replace function public.payment_ops_alert(
  p_signal text, p_severity smallint, p_summary text, p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.ops_alerts (signal, severity, summary, detail)
  values (p_signal, p_severity, left(coalesce(p_summary,''), 300), coalesce(p_detail,'{}'::jsonb))
  on conflict (signal) where resolved_at is null
  do update set last_seen_at = now(),
                summary = excluded.summary,
                detail  = excluded.detail;
end;
$function$;
revoke all on function public.payment_ops_alert(text,smallint,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.payment_ops_alert(text,smallint,text,jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6. RECORDING A DELIVERY. Called after the HMAC passed, before any answer.
--
--    THE EVENT ID IS CHECKED FIRST, and that ordering is the correction. The
--    earlier version matched on the BODY first, so this sequence went
--    undetected: (E1,H1) and (E2,H2) are already stored, and then E1 arrives
--    carrying H2. The body matched row two, the function answered `duplicate`,
--    and the fact that one delivery identity had now named two different
--    payloads was never written down — the conflict this whole mechanism
--    exists to catch, silently swallowed.
--
--    ATOMIC BY UPSERT AND ROW LOCK, not select-then-insert. Two concurrent
--    deliveries of the same body both pass a prior SELECT and both insert; the
--    unique index is the only thing that actually serialises them, so the
--    insert carries `on conflict do nothing` and the re-read takes the row
--    lock.
-- ---------------------------------------------------------------------------
create or replace function public.payment_inbox_record(
  p_provider_event_id   text,
  p_body_sha256         text,
  p_event_name          text,
  p_event_class         text,
  p_provider_order_id   text,
  p_provider_payment_id text,
  p_provider_refund_id  text,
  p_provider_dispute_id text,
  p_amount_minor        bigint,
  p_provider_status     text,
  p_provider_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id        uuid;
  v_alias     public.payment_webhook_event_ids%rowtype;
  v_row       public.payment_webhook_events%rowtype;
  v_duplicate boolean := false;
begin
  -- 1. THE DELIVERY IDENTITY, BEFORE ANYTHING ELSE.
  if p_provider_event_id is not null then
    select * into v_alias from public.payment_webhook_event_ids
     where provider_event_id = p_provider_event_id for update;
    if found and v_alias.body_sha256 is distinct from p_body_sha256 then
      return public.payment_inbox_quarantine(
        v_alias.event_row_id, p_provider_event_id, v_alias.body_sha256, p_body_sha256);
    end if;
  end if;

  -- 2. THE CANONICAL BODY ROW. One row per distinct set of verified bytes.
  --
  --    THE EVENT-ID INDEX CAN FIRE HERE AND `on conflict (body_sha256)` DOES
  --    NOT CATCH IT. Two sessions delivering the SAME event id with DIFFERENT
  --    bodies both pass step 1 (neither alias exists yet), both insert, and the
  --    second blocks on the event-id unique index and then raises
  --    `unique_violation` — a 5xx to the provider, and the conflict this table
  --    exists to record never written down. Handled rather than raised.
  begin
    insert into public.payment_webhook_events (
      provider_event_id, body_sha256, event_name, event_class,
      provider_order_id, provider_payment_id, provider_refund_id, provider_dispute_id,
      amount_minor, provider_status, provider_created_at, state
    ) values (
      p_provider_event_id, p_body_sha256, left(coalesce(p_event_name,''), 64), p_event_class,
      p_provider_order_id, p_provider_payment_id, p_provider_refund_id, p_provider_dispute_id,
      p_amount_minor, p_provider_status, p_provider_created_at,
      case when p_event_class = 'other' then 'ignored' else 'pending' end
    )
    on conflict (body_sha256) do nothing
    returning id into v_id;
  exception when unique_violation then
    -- The only other unique constraint on this table is the event id, so the
    -- winner of that race owns this id now. WHETHER IT IS A CONFLICT DEPENDS ON
    -- ITS BODY, and getting that backwards is worse than the fault being fixed:
    -- twelve simultaneous deliveries of the SAME bytes under the same id also
    -- land here (both indexes are violated and Postgres may report either), and
    -- quarantining those would turn an ordinary redelivery into an incident.
    select * into v_row from public.payment_webhook_events
     where provider_event_id = p_provider_event_id for update;
    if not found then return jsonb_build_object('outcome', 'retry'); end if;
    if v_row.body_sha256 = p_body_sha256 then
      return jsonb_build_object('outcome', 'duplicate', 'id', v_row.id,
                                'state', v_row.state);
    end if;
    return public.payment_inbox_quarantine(
      v_row.id, p_provider_event_id, v_row.body_sha256, p_body_sha256);
  end;

  if v_id is null then
    v_duplicate := true;
    select * into v_row from public.payment_webhook_events
     where body_sha256 = p_body_sha256 for update;
    if not found then
      -- The colliding row was inserted by a transaction that then rolled back.
      return jsonb_build_object('outcome', 'retry');
    end if;
    v_id := v_row.id;
  end if;


  -- 3. THE ALIAS, REMEMBERED WHETHER OR NOT IT IS THE FIRST ONE. A second id
  --    for a body we already hold is not noise: it is what makes a LATER
  --    changed body under that id detectable at step 1.
  if p_provider_event_id is not null then
    insert into public.payment_webhook_event_ids (provider_event_id, event_row_id, body_sha256)
    values (p_provider_event_id, v_id, p_body_sha256)
    on conflict (provider_event_id) do nothing;

    -- Re-read rather than trust the insert: a concurrent delivery may have
    -- claimed this id for different bytes between step 1 and here.
    select * into v_alias from public.payment_webhook_event_ids
     where provider_event_id = p_provider_event_id;
    if v_alias.body_sha256 is distinct from p_body_sha256 then
      return public.payment_inbox_quarantine(
        v_alias.event_row_id, p_provider_event_id, v_alias.body_sha256, p_body_sha256);
    end if;

    -- The column is the FIRST id this body was seen under, for display and for
    -- the existing index. Never overwritten: that would relabel a delivery.
    update public.payment_webhook_events
       set provider_event_id = p_provider_event_id, updated_at = now()
     where id = v_id and provider_event_id is null;
  end if;

  if v_duplicate then
    return jsonb_build_object('outcome', 'duplicate', 'id', v_id, 'state', v_row.state);
  end if;
  return jsonb_build_object('outcome', 'recorded', 'id', v_id);
end;
$function$;

-- One delivery identity, two payloads. Terminal: `conflict` is not claimable,
-- so a worker still holding a lease on this row cannot complete it into `done`.
create or replace function public.payment_inbox_quarantine(
  p_row_id uuid, p_event_id text, p_stored_sha text, p_incoming_sha text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.payment_webhook_events
     set state = 'conflict',
         conflict_sha256 = coalesce(conflict_sha256, p_incoming_sha),
         lease_token = null, lease_expires_at = null,
         last_error = 'event-id-body-mismatch', updated_at = now()
   where id = p_row_id;

  perform public.payment_ops_alert(
    'payment_inbox_conflict', 1::smallint,
    'A webhook event id arrived with a different body — one delivery identity, two payloads.',
    jsonb_build_object('event_id', p_event_id, 'stored_sha256', p_stored_sha,
                       'incoming_sha256', p_incoming_sha));

  return jsonb_build_object('outcome', 'conflict', 'id', p_row_id);
end;
$function$;
revoke all on function public.payment_inbox_quarantine(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.payment_inbox_quarantine(uuid,text,text,text) to service_role;

revoke all on function public.payment_inbox_record(text,text,text,text,text,text,text,text,bigint,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.payment_inbox_record(text,text,text,text,text,text,text,text,bigint,text,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. CLAIMING. `for update skip locked` plus a lease, and the ATTEMPT IS SPENT
--    AT CLAIM TIME.
--
--    Counting on completion only counts workers that came back. A worker that
--    crashes mid-grant never completes, so its attempt was free and the row
--    retries for ever — which is exactly the shape that hammers a provider.
-- ---------------------------------------------------------------------------
create or replace function public.payment_inbox_claim(
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns setof public.payment_webhook_events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with due as (
    select id from public.payment_webhook_events
     where state in ('pending','processing')
       and next_due_at <= now()
       and (lease_expires_at is null or lease_expires_at < now())
       and attempts < public.payment_recovery_max_attempts()
     order by next_due_at, received_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  )
  update public.payment_webhook_events e
     set state = 'processing',
         attempts = e.attempts + 1,
         lease_token = v_token,
         lease_expires_at = now()
           + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds,120), 600))),
         updated_at = now()
    from due
   where e.id = due.id
  returning e.*;
end;
$function$;
revoke all on function public.payment_inbox_claim(integer,integer) from public, anon, authenticated;
grant execute on function public.payment_inbox_claim(integer,integer) to service_role;

-- FENCED COMPLETION: state, token AND an unexpired lease. Two of the three is
-- not enough — a worker whose lease expired and whose row a reaper has already
-- moved on still holds the token, and would otherwise overwrite the new state.
create or replace function public.payment_inbox_complete(
  p_id uuid, p_lease uuid, p_outcome text, p_error text,
  p_backoff_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempts integer;
  v_state    text;
  v_rows     integer;
begin
  if p_outcome not in ('done','ignored','retry','fatal') then
    raise exception 'bad outcome';
  end if;

  select attempts into v_attempts
    from public.payment_webhook_events
   where id = p_id
     and state = 'processing'
     and lease_token = p_lease
     and lease_expires_at > now()
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;

  if p_outcome in ('done','ignored') then
    v_state := p_outcome;
  elsif p_outcome = 'fatal' then
    v_state := 'exhausted';   -- retained: the only record it ever arrived
  else
    v_state := case when v_attempts >= public.payment_recovery_max_attempts()
                    then 'exhausted' else 'pending' end;
  end if;

  update public.payment_webhook_events
     set state = v_state,
         next_due_at = case when v_state = 'pending'
           then now() + make_interval(secs => greatest(10, least(coalesce(p_backoff_seconds,60), 86400)))
           else next_due_at end,
         lease_token = null, lease_expires_at = null,
         last_error = left(coalesce(p_error, ''), 200),
         updated_at = now()
   where id = p_id and state = 'processing' and lease_token = p_lease;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', false, 'reason', 'lease-lost'); end if;

  if v_state = 'exhausted' then perform public.payment_inbox_escalate(p_id); end if;
  return jsonb_build_object('ok', true, 'state', v_state, 'attempts', v_attempts);
end;
$function$;
revoke all on function public.payment_inbox_complete(uuid,uuid,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.payment_inbox_complete(uuid,uuid,text,text,integer) to service_role;

-- THE REAPER. An expired lease is a worker that did not come back. Its attempt
-- has already been spent at claim, so the only question is whether any remain.
create or replace function public.payment_inbox_reap()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requeued integer := 0;
  v_dead     integer := 0;
  r          record;
begin
  for r in
    select id, attempts from public.payment_webhook_events
     where state = 'processing' and lease_expires_at is not null and lease_expires_at < now()
     for update skip locked
  loop
    if r.attempts >= public.payment_recovery_max_attempts() then
      update public.payment_webhook_events
         set state = 'exhausted', lease_token = null, lease_expires_at = null,
             last_error = 'lease-expired-on-final-attempt', updated_at = now()
       where id = r.id;
      perform public.payment_inbox_escalate(r.id);
      v_dead := v_dead + 1;
    else
      update public.payment_webhook_events
         set state = 'pending', lease_token = null, lease_expires_at = null,
             next_due_at = now() + make_interval(secs => 60 * least(r.attempts, 30)),
             last_error = 'lease-expired', updated_at = now()
       where id = r.id;
      v_requeued := v_requeued + 1;
    end if;
  end loop;
  return jsonb_build_object('requeued', v_requeued, 'exhausted', v_dead);
end;
$function$;
revoke all on function public.payment_inbox_reap() from public, anon, authenticated;
grant execute on function public.payment_inbox_reap() to service_role;

-- An exhausted event becomes a person's problem, with an alert and a case.
create or replace function public.payment_inbox_escalate(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.payment_webhook_events%rowtype;
begin
  select * into r from public.payment_webhook_events where id = p_id;
  if not found then return; end if;

  if r.provider_order_id is not null then
    insert into public.payment_cases (case_type, provider_order_id, provider_payment_id,
                                      open_reason, current_event)
    values ('manual_review', r.provider_order_id, r.provider_payment_id,
            'webhook-event-exhausted', r.event_name)
    on conflict do nothing;
  else
    -- AN UNKNOWN ORDER IS THE CASE MOST WORTH OPENING, not the one to skip. A
    -- signed, actionable event whose subject we could never resolve exhausts
    -- with an alert and, before this, no row anybody could resolve. The case is
    -- keyed by the INBOX ID so repeats dedupe, and it is deliberately left
    -- UNLINKED: an order guessed here would be a binding nothing verified.
    insert into public.payment_cases (case_type, provider_case_id, open_reason,
                                      current_event, amount_minor)
    values ('manual_review', 'inbox:' || p_id::text, 'webhook-event-exhausted-unbound',
            r.event_name, r.amount_minor)
    on conflict (provider_case_id) where provider_case_id is not null do nothing;
  end if;


  perform public.payment_ops_alert(
    'payment_inbox_exhausted', 1::smallint,
    'A verified payment webhook could not be processed within its retry budget.',
    jsonb_build_object('event', r.event_name, 'order', r.provider_order_id,
                       'attempts', r.attempts, 'last_error', r.last_error));
end;
$function$;
revoke all on function public.payment_inbox_escalate(uuid) from public, anon, authenticated;
grant execute on function public.payment_inbox_escalate(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. THE RECONCILER'S QUEUE.
--
--    THE ANTI-JOIN IS THE FAIRNESS FIX. Limiting first and relying on
--    ON CONFLICT DO NOTHING re-reads the same oldest 200 rows every tick and
--    discards them all, so purchase 201 is never enqueued — the starvation is
--    permanent, not slow. Excluding what is already cursored BEFORE the limit
--    means every tick makes progress.
--
--    FAILED ATTEMPTS ARE INCLUDED ON PURPOSE: a row marked failed whose payment
--    was in fact captured is exactly what a missed delivery produces.
-- ---------------------------------------------------------------------------
create or replace function public.payment_reconcile_enqueue(p_max integer default 200)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_added integer := 0;
  v_n     integer;
  t       text;
  tables  text[] := array['story_purchases','watermark_purchases','plan_purchases',
                          'video_purchases','payments'];
begin
  foreach t in array tables loop
    execute format($q$
      insert into public.payment_reconcile_cursor (purchase_table, provider_order_id, user_id)
      select %L, p.provider_order_id, p.user_id
        from public.%I p
       where p.provider = 'razorpay'
         and p.provider_order_id is not null
         and p.provider_payment_id is null
         and coalesce(p.status,'') in ('created','pending','attempted','failed')
         and p.created_at > now() - interval '30 days'
         and p.created_at < now() - interval '10 minutes'
         and not exists (select 1 from public.payment_reconcile_cursor c
                          where c.purchase_table = %L and c.provider_order_id = p.provider_order_id)
       order by p.created_at
       limit %s
      on conflict (purchase_table, provider_order_id) do nothing
    $q$, t, t, t, greatest(1, least(coalesce(p_max,200), 1000)));
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  return v_added;
end;
$function$;
revoke all on function public.payment_reconcile_enqueue(integer) from public, anon, authenticated;
grant execute on function public.payment_reconcile_enqueue(integer) to service_role;

-- OLDER THAN THE WINDOW IS NOT NOTHING. A purchase past 30 days is outside what
-- the reconciler will chase, and dropping it silently is how an unpaid-looking
-- row that was actually paid disappears. It becomes a manual-review case.
create or replace function public.payment_reconcile_backfill_aged(p_max integer default 500)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_added integer := 0;
  v_n     integer;
  t       text;
  tables  text[] := array['story_purchases','watermark_purchases','plan_purchases',
                          'video_purchases','payments'];
begin
  foreach t in array tables loop
    execute format($q$
      insert into public.payment_cases (case_type, provider_order_id, purchase_table, user_id,
                                        open_reason)
      select 'manual_review', p.provider_order_id, %L, p.user_id, 'aged-unresolved-purchase'
        from public.%I p
       where p.provider = 'razorpay'
         and p.provider_order_id is not null
         and p.provider_payment_id is null
         and coalesce(p.status,'') in ('created','pending','attempted','failed')
         and p.created_at <= now() - interval '30 days'
         and not exists (select 1 from public.payment_cases k
                          where k.provider_order_id = p.provider_order_id
                            and k.case_type = 'manual_review')
         and not exists (select 1 from public.payment_reconcile_cursor c
                          where c.purchase_table = %L and c.provider_order_id = p.provider_order_id)
       order by p.created_at
       limit %s
      on conflict do nothing
    $q$, t, t, t, greatest(1, least(coalesce(p_max,500), 2000)));
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  return v_added;
end;
$function$;
revoke all on function public.payment_reconcile_backfill_aged(integer)
  from public, anon, authenticated;
grant execute on function public.payment_reconcile_backfill_aged(integer) to service_role;

create or replace function public.payment_reconcile_claim(
  p_limit integer default 5, p_lease_seconds integer default 120
)
returns setof public.payment_reconcile_cursor
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token uuid := gen_random_uuid();
begin
  return query
  with due as (
    select purchase_table, provider_order_id
      from public.payment_reconcile_cursor
     where state in ('pending','processing')
       and next_due_at <= now()
       and (lease_expires_at is null or lease_expires_at < now())
       and attempts < public.payment_recovery_max_attempts()
     order by next_due_at
     limit greatest(1, least(coalesce(p_limit, 5), 25))
     for update skip locked
  )
  update public.payment_reconcile_cursor c
     set state = 'processing',
         attempts = c.attempts + 1,
         lease_token = v_token,
         lease_expires_at = now()
           + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds,120), 600))),
         updated_at = now()
    from due
   where c.purchase_table = due.purchase_table and c.provider_order_id = due.provider_order_id
  returning c.*;
end;
$function$;
revoke all on function public.payment_reconcile_claim(integer,integer) from public, anon, authenticated;
grant execute on function public.payment_reconcile_claim(integer,integer) to service_role;

create or replace function public.payment_reconcile_complete(
  p_table text, p_order text, p_lease uuid, p_outcome text, p_error text,
  p_backoff_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_attempts integer;
  v_user     uuid;
  v_state    text;
  v_rows     integer;
begin
  if p_outcome not in ('resolved','skipped','retry') then
    raise exception 'bad outcome';
  end if;

  select attempts, user_id into v_attempts, v_user
    from public.payment_reconcile_cursor
   where purchase_table = p_table and provider_order_id = p_order
     and state = 'processing' and lease_token = p_lease and lease_expires_at > now()
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'lease-lost'); end if;

  if p_outcome = 'retry' then
    v_state := case when v_attempts >= public.payment_recovery_max_attempts()
                    then 'exhausted' else 'pending' end;
  else
    v_state := p_outcome;
  end if;

  update public.payment_reconcile_cursor
     set state = v_state,
         next_due_at = case when v_state = 'pending'
           then now() + make_interval(secs => greatest(30, least(coalesce(p_backoff_seconds,300), 86400)))
           else next_due_at end,
         lease_token = null, lease_expires_at = null,
         last_error = left(coalesce(p_error,''), 200), updated_at = now()
   where purchase_table = p_table and provider_order_id = p_order
     and state = 'processing' and lease_token = p_lease;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('ok', false, 'reason', 'lease-lost'); end if;

  if v_state = 'exhausted' then
    insert into public.payment_cases (case_type, provider_order_id, purchase_table, user_id,
                                      open_reason)
    values ('manual_review', p_order, p_table, v_user, 'reconciliation-exhausted')
    on conflict do nothing;
    perform public.payment_ops_alert(
      'payment_reconcile_exhausted', 1::smallint,
      'A purchase could not be reconciled with the provider within its retry budget.',
      jsonb_build_object('table', p_table, 'order', p_order));
  end if;

  return jsonb_build_object('ok', true, 'state', v_state, 'attempts', v_attempts);
end;
$function$;
revoke all on function public.payment_reconcile_complete(text,text,uuid,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.payment_reconcile_complete(text,text,uuid,text,text,integer)
  to service_role;

-- THE RECONCILER NEEDS ITS OWN REAPER, and its absence was a silent hole.
-- `payment_inbox_reap` covers the inbox only. A reconcile worker that dies
-- holding the LAST attempt leaves `state = 'processing', attempts = 12`: the
-- claim query requires `attempts < max`, so that row is never claimable again
-- and never exhausted either — it simply sits there, with a purchase behind it
-- that may well be paid. Fenced the same way the inbox is: an unexpired lease
-- is somebody's live work and is left alone.
create or replace function public.payment_reconcile_reap()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_requeued integer := 0;
  v_dead     integer := 0;
  r          record;
begin
  for r in
    select purchase_table, provider_order_id, attempts, user_id
      from public.payment_reconcile_cursor
     where state = 'processing'
       and lease_expires_at is not null and lease_expires_at < now()
     for update skip locked
  loop
    if r.attempts >= public.payment_recovery_max_attempts() then
      update public.payment_reconcile_cursor
         set state = 'exhausted', lease_token = null, lease_expires_at = null,
             last_error = 'lease-expired-on-final-attempt', updated_at = now()
       where purchase_table = r.purchase_table and provider_order_id = r.provider_order_id;

      insert into public.payment_cases (case_type, provider_order_id, purchase_table, user_id,
                                        open_reason)
      values ('manual_review', r.provider_order_id, r.purchase_table, r.user_id,
              'reconciliation-abandoned')
      on conflict do nothing;

      perform public.payment_ops_alert(
        'payment_reconcile_exhausted', 1::smallint,
        'A purchase reconciliation was abandoned on its final attempt and needs a person.',
        jsonb_build_object('table', r.purchase_table, 'order', r.provider_order_id,
                           'attempts', r.attempts, 'reason', 'lease-expired-on-final-attempt'));
      v_dead := v_dead + 1;
    else
      update public.payment_reconcile_cursor
         set state = 'pending', lease_token = null, lease_expires_at = null,
             next_due_at = now() + make_interval(secs => 60 * least(r.attempts, 30)),
             last_error = 'lease-expired', updated_at = now()
       where purchase_table = r.purchase_table and provider_order_id = r.provider_order_id;
      v_requeued := v_requeued + 1;
    end if;
  end loop;
  return jsonb_build_object('requeued', v_requeued, 'exhausted', v_dead);
end;
$function$;
revoke all on function public.payment_reconcile_reap() from public, anon, authenticated;
grant execute on function public.payment_reconcile_reap() to service_role;

-- ---------------------------------------------------------------------------
-- 9. CASES. Atomic, monotonic, reopenable.
--
--    RANK ORDERS DELIVERIES, IT DOES NOT ESTABLISH PROVIDER STATE. Two
--    same-rank terminal events (won and lost) are not a race to be settled by
--    arrival order: the case goes to `needs_provider_refresh` and a person or a
--    fresh provider read decides.
-- ---------------------------------------------------------------------------
-- Which events actually END something. Only these two can be in genuine
-- disagreement at the same rank; `won` and `lost` are the pair that matters.
create or replace function public.payment_case_terminal(p_event text)
returns boolean language sql immutable as $function$
  select coalesce(p_event, '') in ('payment.dispute.won','payment.dispute.lost',
                                   'payment.dispute.closed','refund.processed','refund.failed')
$function$;

create or replace function public.payment_case_upsert(
  p_case_type text, p_case_id text, p_order text, p_payment text,
  p_event text, p_rank integer, p_amount bigint,
  p_user uuid default null, p_table text default null,
  p_open_reason text default 'policy-decision-outstanding',
  p_material_adverse boolean default false,
  p_currency text default null,
  p_verified_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id       uuid;
  v_existing public.payment_cases%rowtype;
  v_rank     integer := coalesce(p_rank, -1);
  v_reopen   boolean;
  v_reopened boolean := false;

begin
  if p_case_type not in ('refund','dispute','manual_review') then
    raise exception 'bad case type';
  end if;
  if p_case_id is null then raise exception 'provider case id required'; end if;

  -- ATOMIC: the insert races and the unique index decides, rather than a SELECT
  -- that both callers pass.
  insert into public.payment_cases (case_type, provider_case_id, provider_order_id,
                                    provider_payment_id, purchase_table, user_id,
                                    current_event, current_rank, amount_minor, currency,
                                    provider_status_verified,
                                    provider_status_verified_at, open_reason)
  values (p_case_type, p_case_id, p_order, p_payment, p_table, p_user,
          p_event, v_rank, p_amount, upper(nullif(p_currency,'')),
          p_verified_status,
          case when p_verified_status is not null then now() end, p_open_reason)
  -- The index is PARTIAL, so inference has to repeat its predicate; without it
  -- Postgres refuses the statement rather than silently using another index.
  on conflict (provider_case_id) where provider_case_id is not null do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.payment_case_events (case_id, kind, event_name, rank)
    values (v_id, 'opened', p_event, v_rank);
    return jsonb_build_object('outcome', 'opened', 'id', v_id);
  end if;

  select * into v_existing from public.payment_cases
   where provider_case_id = p_case_id for update;

  -- A DIFFERING NON-NULL BINDING IS A REFUSAL, NOT A NO-OP. Keeping the old
  -- user id while applying the new amount and status produces one case row
  -- describing two purchases: the fields a person reads to decide come from
  -- one of them and the money from the other. Coalescing hid it completely.
  if (p_user  is not null and v_existing.user_id           is not null
                          and v_existing.user_id           <> p_user)
  or (p_table is not null and v_existing.purchase_table    is not null
                          and v_existing.purchase_table    <> p_table)
  or (p_order is not null and v_existing.provider_order_id is not null
                          and v_existing.provider_order_id <> p_order)
  or (p_payment is not null and v_existing.provider_payment_id is not null
                            and v_existing.provider_payment_id <> p_payment) then
    update public.payment_cases
       set status = 'needs_provider_refresh', open_reason = 'linkage-conflict',
           updated_at = now()
     where id = v_existing.id;
    insert into public.payment_case_events (case_id, kind, event_name, rank, detail)
    values (v_existing.id, 'linkage_refused', p_event, v_rank,
            jsonb_build_object('incoming', jsonb_build_object(
                                 'user', p_user, 'table', p_table,
                                 'order', p_order, 'payment', p_payment),
                               'stored', jsonb_build_object(
                                 'user', v_existing.user_id, 'table', v_existing.purchase_table,
                                 'order', v_existing.provider_order_id,
                                 'payment', v_existing.provider_payment_id)));
    perform public.payment_ops_alert(
      'payment_case_linkage_conflict', 2::smallint,
      'A payment case received a binding that disagrees with the one it already holds.',
      jsonb_build_object('case', v_existing.id, 'provider_case_id', p_case_id));
    -- NOTHING ELSE IS APPLIED. Not the amount, not the status, not the rank.
    return jsonb_build_object('outcome', 'linkage-conflict', 'id', v_existing.id);
  end if;

  -- Linkage can arrive later than the first event, and only from a VERIFIED
  -- binding. Filled once, never overwritten.
  if (v_existing.user_id is null and p_user is not null)
     or (v_existing.purchase_table is null and p_table is not null)
     or (v_existing.provider_order_id is null and p_order is not null)
     or (v_existing.provider_payment_id is null and p_payment is not null) then
    update public.payment_cases
       set user_id = coalesce(user_id, p_user),
           purchase_table = coalesce(purchase_table, p_table),
           provider_order_id = coalesce(provider_order_id, p_order),
           provider_payment_id = coalesce(provider_payment_id, p_payment),
           updated_at = now()
     where id = v_existing.id;
    insert into public.payment_case_events (case_id, kind, detail)
    values (v_existing.id, 'linked',
            jsonb_build_object('user', p_user, 'table', p_table, 'order', p_order,
                               'payment', p_payment));
  end if;

  -- A FRESH PROVIDER READ IS ALWAYS RECORDED, whatever the event stream does.
  -- It is the only thing that can settle a dispute that cycles between states,
  -- and it is a different fact from `current_event` — so it is applied even on
  -- a stale or conflicting delivery, and its absence leaves the case visibly
  -- unverified rather than quietly agreed.
  if p_verified_status is not null then
    update public.payment_cases
       set provider_status_verified = p_verified_status,
           provider_status_verified_at = now(), updated_at = now()
     where id = v_existing.id;
    insert into public.payment_case_events (case_id, kind, event_name, detail)
    values (v_existing.id, 'provider_refreshed', p_event,
            jsonb_build_object('status', p_verified_status));
  end if;

  -- REOPENING FOLLOWS THE FACT, NOT THE EVENT ORDER. Measured on the previous
  -- draft: a case resolved while the provider said `under_review` (rank 20)
  -- stayed RESOLVED when a fresh read came back `lost` under a lower-ranked
  -- delivery, because the only reopen test sat below the stale early return. A
  -- verified adverse state is not a delivery and cannot be stale.
  --
  -- CHANGED, not merely adverse: re-reading the same `lost` an admin has
  -- already seen and closed must not reopen the case for ever. The comparison
  -- is against the verified status the row held BEFORE this call.
  if v_existing.status = 'resolved' and p_material_adverse
     and p_verified_status is not null
     and p_verified_status is distinct from v_existing.provider_status_verified then
    update public.payment_cases
       set status = 'open', open_reason = 'verified-adverse-after-resolution',
           resolution = null, resolved_at = null,
           reopened_count = reopened_count + 1, updated_at = now()
     where id = v_existing.id;
    insert into public.payment_case_events (case_id, kind, event_name, rank, detail)
    values (v_existing.id, 'reopened', p_event, v_rank,
            jsonb_build_object('verified_status', p_verified_status,
                               'previous_verified', v_existing.provider_status_verified,
                               'closed_resolution', v_existing.resolution));
    perform public.payment_ops_alert(
      'payment_case_reopened', 2::smallint,
      'A resolved payment case reopened: the provider''s own state turned against us.',
      jsonb_build_object('case', v_existing.id, 'verified_status', p_verified_status));
    -- The local copy follows, so the rank-driven branch below cannot count the
    -- same reopening a second time and the history stays one event per fact.
    v_existing.status := 'open';
    v_existing.resolution := null;
    v_existing.resolved_at := null;
    v_existing.reopened_count := v_existing.reopened_count + 1;
    v_reopened := true;
  end if;


  -- Currency fills once, beside the amount it qualifies.
  if v_existing.currency is null and nullif(p_currency,'') is not null then
    update public.payment_cases set currency = upper(p_currency), updated_at = now()
     where id = v_existing.id;
  end if;

  -- SAME RANK, DIFFERENT EVENT, AND BOTH TERMINAL: not ours to pick. Limited to
  -- terminal events on purpose — two non-terminal states sharing a rank are an
  -- ordinary duplicate-ish delivery, and escalating those would fill the queue
  -- with "conflicts" that need nobody.
  if v_rank >= 0 and v_rank = v_existing.current_rank
     and v_existing.current_event is distinct from p_event
     and public.payment_case_terminal(p_event)
     and public.payment_case_terminal(v_existing.current_event) then
    update public.payment_cases
       set status = 'needs_provider_refresh', open_reason = 'conflicting-terminal-events',
           updated_at = now()
     where id = v_existing.id;
    insert into public.payment_case_events (case_id, kind, event_name, rank, detail)
    values (v_existing.id, 'conflict', p_event, v_rank,
            jsonb_build_object('previous', v_existing.current_event));
    return jsonb_build_object('outcome', 'conflict', 'id', v_existing.id,
                              'reopened', v_reopened);
  end if;

  -- Out-of-order is ORDINARY: Razorpay does not guarantee ordering, so an
  -- earlier event arriving later is dropped rather than applied. The DELIVERY
  -- is stale; a reopening done above on a verified fact is not, and travels
  -- back beside it so a caller cannot read "stale" as "nothing happened".
  if v_rank <= v_existing.current_rank then
    insert into public.payment_case_events (case_id, kind, event_name, rank)
    values (v_existing.id, 'stale', p_event, v_rank);
    return jsonb_build_object('outcome', 'stale', 'id', v_existing.id,
                              'current_event', v_existing.current_event,
                              'reopened', v_reopened);
  end if;

  -- A resolved case that receives NEW material adverse news is reopened.
  -- Leaving it closed would hide a chargeback behind yesterday's decision. The
  -- resolution itself is kept in the history. (Already false when the verified
  -- read above reopened it: the local copy was updated there.)
  v_reopen := v_existing.status = 'resolved' and p_material_adverse;

  update public.payment_cases
     set current_event = p_event, current_rank = v_rank,
         amount_minor = coalesce(p_amount, amount_minor),
         status = case when v_reopen then 'open' else v_existing.status end,
         reopened_count = v_existing.reopened_count + case when v_reopen then 1 else 0 end,
         resolution = case when v_reopen then null else v_existing.resolution end,
         resolved_at = case when v_reopen then null else v_existing.resolved_at end,
         updated_at = now()
   where id = v_existing.id;

  insert into public.payment_case_events (case_id, kind, event_name, rank, detail)
  values (v_existing.id, case when v_reopen then 'reopened' else 'advanced' end,
          p_event, v_rank, jsonb_build_object('from', v_existing.current_event));

  return jsonb_build_object('outcome',
                            case when v_reopen or v_reopened then 'reopened' else 'advanced' end,
                            'id', v_existing.id, 'reopened', v_reopen or v_reopened);

end;
$function$;
revoke all on function public.payment_case_upsert(text,text,text,text,text,integer,bigint,uuid,text,text,boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.payment_case_upsert(text,text,text,text,text,integer,bigint,uuid,text,text,boolean,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 10. THE ADMIN SURFACE. `is_admin` is a DB-controlled column, never token
--     metadata — and a NULL subject fails closed BEFORE it is consulted, so an
--     unauthenticated call can never depend on how is_admin(null) behaves.
-- ---------------------------------------------------------------------------
create or replace function public.payment_recovery_overview()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not public.is_admin(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'inbox', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
                from (select state, count(*) n from public.payment_webhook_events group by state) s),
    'reconcile', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
                from (select state, count(*) n from public.payment_reconcile_cursor group by state) r),
    'cases', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                from (select id, case_type, provider_case_id, provider_order_id,
                             provider_payment_id, amount_minor, currency,
                             provider_status_verified, provider_status_verified_at,
                             current_event, status,
                             open_reason, resolution, resolution_note, reopened_count,
                             opened_at, updated_at
                        from public.payment_cases order by status, updated_at desc limit 100) c),
    'stuck', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
                from (select id, event_name, event_class, provider_order_id, provider_payment_id,
                             state, attempts, last_error, received_at
                        from public.payment_webhook_events
                       where state in ('exhausted','conflict')
                       order by received_at desc limit 50) e)
  ) into v_out;
  return v_out;
end;
$function$;
revoke all on function public.payment_recovery_overview() from public, anon, authenticated;
grant execute on function public.payment_recovery_overview() to authenticated, service_role;

-- THE OLD THREE-ARGUMENT FORM IS DROPPED, NOT DEFAULTED. A defaulted fourth
-- parameter creates a second callable signature, and a three-argument call is
-- then ambiguous — which fails in production at call time rather than here.
-- Dropping it also means no caller can quietly keep the unguarded version.
drop function if exists public.payment_case_resolve(uuid, text, text);

create or replace function public.payment_case_resolve(
  p_case_id uuid, p_resolution text, p_note text, p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid  uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_case public.payment_cases%rowtype;
begin
  if v_uid is null or not public.is_admin(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_resolution not in ('no_action','entitlement_revoked','refund_acknowledged',
                          'duplicate','other') then
    raise exception 'bad resolution';
  end if;
  -- A decision with no reason is not reviewable six months later.
  if length(v_note) < 8 or length(v_note) > 500 then
    raise exception 'a note of 8 to 500 characters is required';
  end if;
  if p_expected_updated_at is null then
    raise exception 'the version of the case being closed is required';
  end if;

  -- ═══ THE VERSION CHECK IS UNDER THE LOCK, AND THE LOCK COMES FIRST ═══
  -- An admin reads a case, a refund advances to `lost` while the tab is open,
  -- and the save would otherwise close a case describing money that has since
  -- moved. Comparing `updated_at` BEFORE taking the row lock is the same race
  -- one level down: the writer can land between the read and the update.
  select * into v_case from public.payment_cases where id = p_case_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not-found');
  end if;

  -- Compared as an instant, never as text: two renderings of one moment differ
  -- by offset and by digits of precision, so a string compare would reject
  -- every honest save from a client that formats its timestamps differently.
  if v_case.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok', false, 'reason', 'stale',
                              'current_updated_at', v_case.updated_at);
  end if;
  if v_case.status not in ('open','needs_provider_refresh') then
    return jsonb_build_object('ok', false, 'reason', 'not-open');
  end if;

  -- THIS RECORDS A DECISION, IT DOES NOT TAKE AN ACTION. Nothing here issues a
  -- refund, revokes an entitlement or moves money.
  update public.payment_cases
     set status = 'resolved', resolution = p_resolution, resolution_note = v_note,
         resolved_by = v_uid, resolved_at = now(), updated_at = now()
   where id = p_case_id;

  insert into public.payment_case_events (case_id, kind, actor, detail)
  values (p_case_id, 'resolved', v_uid,
          jsonb_build_object('resolution', p_resolution, 'note', v_note,
                             'closed_version', p_expected_updated_at));
  return jsonb_build_object('ok', true);
end;
$function$;
revoke all on function public.payment_case_resolve(uuid,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.payment_case_resolve(uuid,text,text,timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10b. THE AUDIT TRAIL, READ BACK. `payment_case_events` is append-only by
--      trigger, so this is the durable history of every decision — including
--      the ones a later reopening superseded. Admin-gated in SQL like its
--      neighbours; the client's own check is a convenience, never the control.
-- ---------------------------------------------------------------------------
create or replace function public.payment_case_history(p_case_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null or not public.is_admin(v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.id), '[]'::jsonb) into v_out
    from (select id, kind, event_name, rank, detail, actor, created_at
            from public.payment_case_events
           where case_id = p_case_id
           order by id limit 200) h;
  return v_out;
end;
$function$;
revoke all on function public.payment_case_history(uuid) from public, anon, authenticated;
grant execute on function public.payment_case_history(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10c. THE CUSTOMER'S OWN VIEW. Filtered by ownership IN SQL, and minimal.
--
--      WHAT IS DELIBERATELY ABSENT: `resolution_note` and every
--      `payment_case_events` row. Those are ONIQ's internal review notes and
--      the person they are about is not their audience — a note naming another
--      order, a colleague or an internal reference would leak through a screen
--      built to reassure.
--
--      A case with a NULL `user_id` belongs to nobody here and is returned to
--      nobody. Cases opened by the exhaustion reaper carry no user id, so they
--      are invisible to this function by construction rather than by a filter
--      somebody could drop.
-- ---------------------------------------------------------------------------
create or replace function public.payment_cases_mine()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_out jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.opened_at desc), '[]'::jsonb) into v_out
    from (select id, case_type, status, amount_minor, currency,
                 provider_status_verified, provider_status_verified_at,
                 provider_order_id, opened_at, updated_at
            from public.payment_cases
           where user_id = v_uid
           order by opened_at desc limit 20) c;
  return v_out;
end;
$function$;
revoke all on function public.payment_cases_mine() from public, anon;
grant execute on function public.payment_cases_mine() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. THE TICK, AND THE SCHEDULE AS A SEPARATE STEP.
--
--     The tick is defined; NO CRON JOB IS CREATED. Scheduling it before the
--     worker exists produces a job that fails every two minutes and an
--     `ops_alerts` row about our own deployment order.
--
--     The credential is read from Vault at call time and never written here.
--     The key is chosen by SHAPE, not by name — `ops_watch_pick_key()` exists
--     because a name preference produced a watchdog that detected for ever and
--     announced never. Reused, not re-derived.
--
--     THE WORKER VERIFIES THE TOKEN CRYPTOGRAPHICALLY, by constant-time
--     comparison against the service credential it holds. A decoded `role`
--     claim is a claim; anyone can mint a JWT that says service_role.
-- ---------------------------------------------------------------------------
--     MAINTENANCE AND DISPATCH ARE TWO FUNCTIONS, and separating them is not
--     tidiness. The worker itself must run the maintenance half at the top of
--     every invocation, or a lease abandoned by a crashed worker waits for the
--     next cron minute. If it called the TICK to do that, the tick would POST
--     the worker, which would call the tick, which would POST the worker: one
--     scheduled minute becomes an unbounded fan-out of invocations, each one
--     of them billable and each one of them claiming rows. `maintain` is the
--     half that touches only our own tables; `tick` is `maintain` plus exactly
--     one dispatch, and only cron calls it.
-- ---------------------------------------------------------------------------
-- 11a. THE ALERT LIFECYCLE.
--
--     `ops_watch_tick` resolves only its OWN story/budget signals, so a payment
--     alert opened here would stay open for ever once the incident behind it
--     was dealt with — and an alert that never clears is an alert nobody reads,
--     which is the same outcome as no alert.
--
--     HISTORY IS PRESERVED AND `notified_at` IS NEVER WRITTEN. Resolving stamps
--     `resolved_at` on the row that already exists; the watchdog's own delivery
--     pass then sends the recovery notice, exactly as it does for its signals.
-- ---------------------------------------------------------------------------
create or replace function public.payment_ops_resolve(p_signal text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_rows integer;
begin
  update public.ops_alerts set resolved_at = now()
   where signal = p_signal and resolved_at is null;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
revoke all on function public.payment_ops_resolve(text) from public, anon, authenticated;
grant execute on function public.payment_ops_resolve(text) to service_role;

-- Each signal's condition, re-derived from the tables rather than remembered.
-- A signal is resolved only when the thing it named is actually gone, so an
-- admin closing one case out of three does not silence the other two.
create or replace function public.payment_recovery_alert_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_closed integer := 0;
begin
  if not exists (select 1 from public.payment_webhook_events where state = 'conflict') then
    v_closed := v_closed + public.payment_ops_resolve('payment_inbox_conflict');
  end if;

  -- An exhausted event is addressed when the case it opened is resolved. The
  -- inbox row itself stays `exhausted` for ever — it is the record that this
  -- happened — so the row's own state cannot be the condition.
  if not exists (
    select 1 from public.payment_webhook_events e
     where e.state = 'exhausted'
       and exists (select 1 from public.payment_cases c
                    where c.status <> 'resolved'
                      and (c.provider_order_id = e.provider_order_id
                           or c.provider_case_id = 'inbox:' || e.id::text))
  ) then
    v_closed := v_closed + public.payment_ops_resolve('payment_inbox_exhausted');
  end if;

  if not exists (select 1 from public.payment_cases
                  where status <> 'resolved' and open_reason = 'linkage-conflict') then
    v_closed := v_closed + public.payment_ops_resolve('payment_case_linkage_conflict');
  end if;

  if not exists (select 1 from public.payment_cases
                  where status <> 'resolved'
                    and open_reason = 'verified-adverse-after-resolution') then
    v_closed := v_closed + public.payment_ops_resolve('payment_case_reopened');
  end if;

  return jsonb_build_object('alerts_resolved', v_closed);
end;
$function$;
revoke all on function public.payment_recovery_alert_sweep() from public, anon, authenticated;
grant execute on function public.payment_recovery_alert_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- 11b. IS THE WORKER ALIVE?
--
--     A tick that POSTs and never looks is a tick that reports success while a
--     wrong credential 401s every two minutes and the queue grows for ever.
--     Two independent facts are kept, because either alone can lie: the
--     RESPONSE the dispatch got (the worker answered, and how), and the
--     HEARTBEAT the worker itself writes (it ran, and got as far as its own
--     first statement). A missing response and a missing heartbeat mean
--     different things — cron did not fire versus the worker refused entry.
--
--     NO BODIES AND NO SECRETS ARE STORED. A status code and two timestamps.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_recovery_dispatches (
  id            bigserial   primary key,
  request_id    bigint,
  dispatched_at timestamptz not null default now(),
  status_code   integer,
  observed_at   timestamptz
);
create index if not exists payment_recovery_dispatches_recent
  on public.payment_recovery_dispatches (dispatched_at desc);
alter table public.payment_recovery_dispatches enable row level security;
revoke all on public.payment_recovery_dispatches from public, anon, authenticated;
grant select, insert, update on public.payment_recovery_dispatches to service_role;
grant usage, select on sequence public.payment_recovery_dispatches_id_seq to service_role;

create table if not exists public.payment_recovery_heartbeat (
  id        boolean     primary key default true check (id),
  last_run_at timestamptz not null default now()
);
alter table public.payment_recovery_heartbeat enable row level security;
revoke all on public.payment_recovery_heartbeat from public, anon, authenticated;
grant select, insert, update on public.payment_recovery_heartbeat to service_role;

-- Called by the worker at the top of a run, before any claim: it records that
-- the credential was accepted and the handler entered, which is precisely what
-- a 401 or an undeployed function does not do.
create or replace function public.payment_recovery_beat()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.payment_recovery_heartbeat (id, last_run_at) values (true, now())
  on conflict (id) do update set last_run_at = now();
end;
$function$;
revoke all on function public.payment_recovery_beat() from public, anon, authenticated;
grant execute on function public.payment_recovery_beat() to service_role;

-- Reads the PREVIOUS dispatch's outcome. Run at the start of a tick rather than
-- the end of the last one, because a tick cannot observe a response it has not
-- waited for and waiting is what a cron minute must not do.
create or replace function public.payment_recovery_observe_dispatch()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r        public.payment_recovery_dispatches%rowtype;
  v_status integer;
  v_beat   timestamptz;
  v_pending integer;
begin
  select * into r from public.payment_recovery_dispatches
   where observed_at is null and request_id is not null
   order by dispatched_at asc limit 1;
  if not found then return jsonb_build_object('observed', false); end if;

  -- A response that has not arrived yet is not a failure: only one that is
  -- overdue is. `net._http_response` is pruned by pg_net, so an absent row for
  -- an OLD request is indistinguishable from a pruned one and is reported as
  -- `absent` rather than as a specific fault.
  begin
    execute 'select status_code from net._http_response where id = $1'
      into v_status using r.request_id;
  exception when others then
    v_status := null;
  end;

  if v_status is null and r.dispatched_at > now() - interval '5 minutes' then
    return jsonb_build_object('observed', false, 'reason', 'too-soon');
  end if;

  update public.payment_recovery_dispatches
     set status_code = v_status, observed_at = now() where id = r.id;

  select last_run_at into v_beat from public.payment_recovery_heartbeat where id;
  select count(*) into v_pending from public.payment_webhook_events
   where state in ('pending','processing');

  if v_status = 200 then
    perform public.payment_ops_resolve('payment_recovery_worker_unhealthy');
  else
    perform public.payment_ops_alert(
      'payment_recovery_worker_unhealthy', 1::smallint,
      'The payment recovery worker did not answer its scheduled dispatch.',
      jsonb_build_object('status_code', v_status,
                         'dispatched_at', r.dispatched_at,
                         'last_worker_run_at', v_beat,
                         'pending_events', v_pending));
  end if;

  return jsonb_build_object('observed', true, 'status_code', v_status,
                            'last_worker_run_at', v_beat, 'pending_events', v_pending);
end;
$function$;
revoke all on function public.payment_recovery_observe_dispatch()
  from public, anon, authenticated;
grant execute on function public.payment_recovery_observe_dispatch() to service_role;

create or replace function public.payment_recovery_maintain()

returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_added integer; v_aged integer; v_reaped jsonb; v_rreaped jsonb; v_alerts jsonb;
begin
  -- One maintainer at a time. Taken here rather than in the tick so a worker
  -- invocation and a cron minute that overlap cannot both reap and enqueue.
  perform pg_advisory_xact_lock(hashtext('payment_recovery_tick'));
  v_reaped  := public.payment_inbox_reap();
  -- BOTH reapers. The inbox one alone leaves an abandoned final reconcile
  -- attempt stuck in `processing` for ever.
  v_rreaped := public.payment_reconcile_reap();
  v_added   := public.payment_reconcile_enqueue(200);
  -- And the aged sweep is CALLED, not merely defined: a bounded backfill that
  -- nothing invokes is a report nobody runs, and the rows it exists to surface
  -- are by definition the ones already older than a month.
  v_aged    := public.payment_reconcile_backfill_aged(200);
  -- And the alerts are CLOSED here too, for the same reason: an open row whose
  -- incident is over is noise that trains whoever reads it to stop looking.
  v_alerts  := public.payment_recovery_alert_sweep();
  return jsonb_build_object('enqueued', v_added, 'aged', v_aged,
                            'reaped', v_reaped, 'reconcile_reaped', v_rreaped,
                            'alerts', v_alerts);

end;
$function$;
revoke all on function public.payment_recovery_maintain() from public, anon, authenticated;
grant execute on function public.payment_recovery_maintain() to service_role;

create or replace function public.payment_recovery_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key text; v_req bigint; v_maint jsonb; v_health jsonb;
  -- THE WORKER HAS NO FUNCTION OF ITS OWN. This project cannot add edge
  -- functions, so it is an explicit, credential-gated MODE on the webhook that
  -- already exists. The mode is matched exactly; a missing or misspelt one is
  -- refused rather than falling through to the provider branch.
  v_url text := 'https://bqwttemnnoexadpwifcj.supabase.co/functions/v1/razorpay-webhook?mode=recovery';
begin
  -- BEFORE dispatching again: did the last one land? Otherwise a wrong
  -- credential or an undeployed worker is a silent 401 every two minutes.
  v_health := public.payment_recovery_observe_dispatch();
  v_maint  := public.payment_recovery_maintain();

  v_key := public.ops_watch_pick_key();
  if v_key is null then
    raise warning 'payment_recovery_tick: no service credential available';
    -- AND IT IS AN ALERT, not only a warning nobody reads. A missing credential
    -- is the exact failure that leaves work pending for ever with no attempts.
    perform public.payment_ops_alert(
      'payment_recovery_worker_unhealthy', 1::smallint,
      'The payment recovery tick has no service credential and dispatched nothing.',
      jsonb_build_object('reason', 'no-credential'));
    return v_maint || jsonb_build_object('dispatched', false, 'health', v_health);
  end if;

  select net.http_post(
           url := v_url,
           headers := jsonb_build_object('Content-Type','application/json',
                                         'Authorization','Bearer ' || v_key),
           body := jsonb_build_object('source','cron','action','run'),
           timeout_milliseconds := 55000) into v_req;

  -- The request id is what makes the NEXT tick able to say whether this one was
  -- answered. Recorded before returning; no header, body or key goes with it.
  insert into public.payment_recovery_dispatches (request_id) values (v_req);

  return v_maint || jsonb_build_object('dispatched', true, 'request_id', v_req,
                                       'health', v_health);

end;
$function$;
revoke all on function public.payment_recovery_tick() from public, anon, authenticated;

-- RUN THIS ONLY AFTER the webhook carrying `?mode=recovery` is deployed AND one
-- manual call with the key `ops_watch_pick_key()` returns — `{"action":"probe"}`,
-- which reads nothing and writes nothing — has answered 200 rather than 401.
-- STILL NOT CALLED BY THIS FILE: applying the migration creates no schedule.
create or replace function public.payment_recovery_setup_schedule()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform cron.unschedule('payment-recovery')
    where exists (select 1 from cron.job where jobname = 'payment-recovery');
  perform cron.schedule('payment-recovery', '*/2 * * * *',
                        $$select public.payment_recovery_tick();$$);
  return 'scheduled';
end;
$function$;
revoke all on function public.payment_recovery_setup_schedule() from public, anon, authenticated;

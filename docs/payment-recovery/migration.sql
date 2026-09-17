-- ONIQ payment operations recovery — cycle 1. NOT APPLIED.
--
-- This file is the reviewable SQL. It is deliberately NOT in
-- supabase/migrations/: that directory is owned by the migration tool, which
-- APPLIES what it writes, and the instruction for this cycle is code and tests
-- first, production untouched until the diff has been read. Applying it is one
-- call with this file's contents, byte for byte, after review.
--
-- THE GAP THIS CLOSES, stated as the code already states it. `razorpay-webhook`
-- answers a retryable non-2xx when a handled event could not be processed, and
-- its own header says what that leaves open: once Razorpay stops retrying, a
-- captured payment nobody granted is gone, and nothing anywhere records that it
-- happened. Delivery is the provider's promise; DURABILITY has to be ours.
--
-- THREE FAILURE MODES, THREE STRUCTURES:
--   1. delivered but not processed      -> public.payment_webhook_events (inbox)
--   2. never delivered at all           -> public.payment_reconcile_cursor
--   3. money going back out             -> public.payment_cases
--
-- WHAT IS DELIBERATELY NOT HERE. No refund is issued, no capture is made, no
-- clawback is computed, no payout is touched and no order-creation path is
-- altered. A refund or dispute event opens a CASE for a person; the outstanding
-- policy decision is recorded as outstanding rather than guessed at. Under this
-- project's first rule, what ONIQ does with a customer's money back is the
-- owner's call, not an engineering one.
--
-- WHAT IS STORED IS MINIMAL. Identifiers, the event name, a minor-unit amount,
-- a provider status, timestamps, and a SHA-256 of the exact verified bytes.
-- NOT the payload: a webhook body carries email, contact, card fingerprint, VPA
-- and our own notes, and none of it is evidence — every grant is re-derived
-- from our own row plus a fresh server-side read of the provider's record. The
-- digest is what makes a redelivery recognisable without keeping what it hashes.
--
-- GRANTS ARE EXPLICIT AND NARROW. This project does not grant default
-- privileges on new public tables, and these tables want none: every write is
-- the service role, and the only client-reachable surface is two admin RPCs
-- gated on the DB-controlled `public.is_admin`, never on editable metadata.

-- ---------------------------------------------------------------------------
-- 1. THE INBOX. One row per verified delivery, written before we acknowledge.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_webhook_events (
  id                   uuid        primary key default gen_random_uuid(),
  -- The provider's own delivery identity when it sent one, else the digest of
  -- the verified body. See payment_inbox_record for why that fallback is safe.
  dedup_key            text        not null,
  provider_event_id    text,
  body_sha256          text        not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  event_name           text        not null,
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
  received_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- THE DEDUP IS AN INDEX, NOT A CONVENTION. Razorpay documents that the same
-- delivery can arrive more than once and out of order, so a redelivery must
-- collide here rather than be processed twice.
create unique index if not exists payment_webhook_events_dedup
  on public.payment_webhook_events (dedup_key);

-- The claim query's index: due, unfinished, oldest first.
create index if not exists payment_webhook_events_due
  on public.payment_webhook_events (next_due_at)
  where state in ('pending','processing');

create index if not exists payment_webhook_events_order
  on public.payment_webhook_events (provider_order_id)
  where provider_order_id is not null;

alter table public.payment_webhook_events enable row level security;

-- ---------------------------------------------------------------------------
-- 2. THE RECONCILER'S CURSOR. One row per unresolved purchase we are chasing.
--
--    A SEPARATE TABLE RATHER THAN COLUMNS ON THE FIVE PURCHASE TABLES: those
--    are the order-creation path's own tables and this cycle does not touch
--    them. It also means the cursor can carry per-row backoff without any
--    write amplification on a table a checkout is inserting into.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_reconcile_cursor (
  purchase_table    text        not null,
  provider_order_id text        not null,
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

-- ORDERED BY DUE TIME, NOT BY AGE. Ordering by created_at would let the oldest
-- unresolvable rows monopolise every batch for ever and starve a purchase that
-- arrived this minute — the failure the backoff exists to avoid.
create index if not exists payment_reconcile_cursor_due
  on public.payment_reconcile_cursor (next_due_at)
  where state in ('pending','processing');

alter table public.payment_reconcile_cursor enable row level security;

-- ---------------------------------------------------------------------------
-- 3. CASES. Refunds, disputes, and anything the machinery gave up on.
-- ---------------------------------------------------------------------------
create table if not exists public.payment_cases (
  id                  uuid        primary key default gen_random_uuid(),
  case_type           text        not null
                        check (case_type in ('refund','dispute','manual_review')),
  -- The provider's refund or dispute id; null for a manual review case.
  provider_case_id    text,
  provider_order_id   text,
  provider_payment_id text,
  purchase_table      text,
  user_id             uuid references auth.users(id) on delete set null,
  amount_minor        bigint      check (amount_minor is null or amount_minor >= 0),
  -- The furthest-along event this case has seen, and its rank. Rank is what
  -- makes an out-of-order delivery a no-op instead of a regression.
  current_event       text,
  current_rank        integer     not null default -1,
  status              text        not null default 'open'
                        check (status in ('open','resolved')),
  -- Why the case is still open. There is no entitlement/clawback policy in this
  -- repository, so a refund request is recorded as an outstanding DECISION and
  -- never as a completed refund.
  open_reason         text        not null default 'policy-decision-outstanding',
  resolution          text        check (resolution in ('no_action','entitlement_revoked',
                                                        'refund_acknowledged','duplicate',
                                                        'other')),
  resolution_note     text,
  resolved_by         uuid        references auth.users(id) on delete set null,
  resolved_at         timestamptz,
  opened_at           timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One case per provider case id. A manual-review case is keyed on the order
-- instead, so a purchase cannot accumulate a case per failed attempt.
create unique index if not exists payment_cases_provider_case
  on public.payment_cases (provider_case_id) where provider_case_id is not null;
create unique index if not exists payment_cases_manual_per_order
  on public.payment_cases (provider_order_id)
  where case_type = 'manual_review' and provider_order_id is not null;
create index if not exists payment_cases_open_first
  on public.payment_cases (status, updated_at desc);

alter table public.payment_cases enable row level security;

-- ---------------------------------------------------------------------------
-- 4. ACL. Explicit, because nothing is granted by default — and narrow, because
--    a client that could write here could manufacture evidence of a payment.
-- ---------------------------------------------------------------------------
revoke all on public.payment_webhook_events   from public, anon, authenticated;
revoke all on public.payment_reconcile_cursor from public, anon, authenticated;
revoke all on public.payment_cases            from public, anon, authenticated;

grant select, insert, update on public.payment_webhook_events   to service_role;
grant select, insert, update on public.payment_reconcile_cursor to service_role;
grant select, insert, update on public.payment_cases            to service_role;

-- RLS is ON with NO policy for anon/authenticated on any of the three: there is
-- no direct client read path at all. Admins reach cases through the RPC below,
-- which re-derives the admin check server-side.

-- ---------------------------------------------------------------------------
-- 5. RECORDING A DELIVERY. Called by the webhook AFTER the HMAC passed and
--    BEFORE it answers anything.
--
--    CONFLICT IS A STATE, NOT AN ERROR. The same provider event id arriving
--    with a DIFFERENT body is not a redelivery — it is either a provider
--    surprise or something between us rewriting payloads, and both are worth a
--    person's attention. It is retained as `conflict` and never processed.
-- ---------------------------------------------------------------------------
create or replace function public.payment_inbox_record(
  p_dedup_key           text,
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
  v_existing public.payment_webhook_events%rowtype;
  v_id       uuid;
begin
  select * into v_existing
    from public.payment_webhook_events
   where dedup_key = p_dedup_key
   for update;

  if found then
    if v_existing.body_sha256 is distinct from p_body_sha256 then
      update public.payment_webhook_events
         set state = 'conflict', updated_at = now(),
             last_error = 'event-id-body-mismatch'
       where id = v_existing.id and state <> 'conflict';
      return jsonb_build_object('outcome', 'conflict', 'id', v_existing.id);
    end if;
    return jsonb_build_object('outcome', 'duplicate', 'id', v_existing.id,
                              'state', v_existing.state);
  end if;

  insert into public.payment_webhook_events (
    dedup_key, provider_event_id, body_sha256, event_name, event_class,
    provider_order_id, provider_payment_id, provider_refund_id, provider_dispute_id,
    amount_minor, provider_status, provider_created_at,
    state
  ) values (
    p_dedup_key, p_provider_event_id, p_body_sha256, p_event_name, p_event_class,
    p_provider_order_id, p_provider_payment_id, p_provider_refund_id, p_provider_dispute_id,
    p_amount_minor, p_provider_status, p_provider_created_at,
    case when p_event_class = 'other' then 'ignored' else 'pending' end
  )
  returning id into v_id;

  return jsonb_build_object('outcome', 'recorded', 'id', v_id);
end;
$function$;

revoke all on function public.payment_inbox_record(text,text,text,text,text,text,text,text,text,bigint,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.payment_inbox_record(text,text,text,text,text,text,text,text,text,bigint,text,timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. CLAIMING WORK. `for update skip locked` plus a LEASE.
--
--    THE LOCK IS NOT ENOUGH ON ITS OWN. It is released when the claiming
--    transaction commits, and the work happens afterwards — in an edge function
--    that can be killed by its own wall clock. So the claim writes a lease
--    token and an expiry, and completion is FENCED on that token: a worker that
--    lost its lease and comes back later cannot overwrite the state a second
--    worker has since written.
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
     order by next_due_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked
  )
  update public.payment_webhook_events e
     set state = 'processing',
         lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds,120), 600))),
         updated_at = now()
    from due
   where e.id = due.id
  returning e.*;
end;
$function$;

revoke all on function public.payment_inbox_claim(integer,integer) from public, anon, authenticated;
grant execute on function public.payment_inbox_claim(integer,integer) to service_role;

-- FENCED COMPLETION. Every update carries `and lease_token = p_lease`, so a
-- late worker's write is refused rather than applied. The outcome says which,
-- so the caller can tell "finished" from "your lease was gone".
create or replace function public.payment_inbox_complete(
  p_id      uuid,
  p_lease   uuid,
  p_outcome text,      -- 'done' | 'ignored' | 'retry' | 'fatal'
  p_error   text,
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
   where id = p_id and lease_token = p_lease
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;

  if p_outcome in ('done','ignored') then
    v_state := p_outcome;
  elsif p_outcome = 'fatal' then
    -- A permanently un-processable event is RETAINED, never deleted: it is the
    -- only record that something arrived and was refused.
    v_state := 'exhausted';
  else
    v_attempts := v_attempts + 1;
    v_state := case when v_attempts >= 12 then 'exhausted' else 'pending' end;
  end if;

  update public.payment_webhook_events
     set state = v_state,
         attempts = case when p_outcome = 'retry' then v_attempts else attempts end,
         next_due_at = case when v_state = 'pending'
                            then now() + make_interval(secs => greatest(10, least(coalesce(p_backoff_seconds,60), 86400)))
                            else next_due_at end,
         lease_token = null,
         lease_expires_at = null,
         last_error = left(coalesce(p_error, ''), 200),
         updated_at = now()
   where id = p_id and lease_token = p_lease;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;

  return jsonb_build_object('ok', true, 'state', v_state, 'attempts', v_attempts);
end;
$function$;

revoke all on function public.payment_inbox_complete(uuid,uuid,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.payment_inbox_complete(uuid,uuid,text,text,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 7. THE RECONCILER'S QUEUE. Unresolved purchases across all five tables,
--    INCLUDING failed attempts — a `failed` row whose payment was in fact
--    captured is the exact case a missed delivery produces.
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
      insert into public.payment_reconcile_cursor (purchase_table, provider_order_id)
      select %L, p.provider_order_id
        from public.%I p
       where p.provider = 'razorpay'
         and p.provider_order_id is not null
         and p.provider_payment_id is null
         and coalesce(p.status,'') in ('created','pending','attempted','failed')
         and p.created_at > now() - interval '30 days'
         and p.created_at < now() - interval '10 minutes'
       limit %s
      on conflict (purchase_table, provider_order_id) do nothing
    $q$, t, t, greatest(1, least(coalesce(p_max,200), 1000)));
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  return v_added;
end;
$function$;

revoke all on function public.payment_reconcile_enqueue(integer) from public, anon, authenticated;
grant execute on function public.payment_reconcile_enqueue(integer) to service_role;

create or replace function public.payment_reconcile_claim(
  p_limit integer default 5,
  p_lease_seconds integer default 120
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
     order by next_due_at
     limit greatest(1, least(coalesce(p_limit, 5), 25))
     for update skip locked
  )
  update public.payment_reconcile_cursor c
     set state = 'processing',
         lease_token = v_token,
         lease_expires_at = now() + make_interval(secs => greatest(10, least(coalesce(p_lease_seconds,120), 600))),
         updated_at = now()
    from due
   where c.purchase_table = due.purchase_table
     and c.provider_order_id = due.provider_order_id
  returning c.*;
end;
$function$;

revoke all on function public.payment_reconcile_claim(integer,integer) from public, anon, authenticated;
grant execute on function public.payment_reconcile_claim(integer,integer) to service_role;

create or replace function public.payment_reconcile_complete(
  p_table   text,
  p_order   text,
  p_lease   uuid,
  p_outcome text,   -- 'resolved' | 'skipped' | 'retry'
  p_error   text,
  p_backoff_seconds integer default 300
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
  if p_outcome not in ('resolved','skipped','retry') then
    raise exception 'bad outcome';
  end if;

  select attempts into v_attempts
    from public.payment_reconcile_cursor
   where purchase_table = p_table and provider_order_id = p_order and lease_token = p_lease
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;

  if p_outcome = 'retry' then
    v_attempts := v_attempts + 1;
    v_state := case when v_attempts >= 12 then 'exhausted' else 'pending' end;
  else
    v_state := p_outcome;
  end if;

  update public.payment_reconcile_cursor
     set state = v_state,
         attempts = v_attempts,
         next_due_at = case when v_state = 'pending'
                            then now() + make_interval(secs => greatest(30, least(coalesce(p_backoff_seconds,300), 86400)))
                            else next_due_at end,
         lease_token = null,
         lease_expires_at = null,
         last_error = left(coalesce(p_error,''), 200),
         updated_at = now()
   where purchase_table = p_table and provider_order_id = p_order and lease_token = p_lease;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'reason', 'lease-lost');
  end if;

  -- AFTER THE WINDOW, A PERSON. An exhausted cursor is a purchase that may or
  -- may not have been paid and that no machine here can settle, so it becomes
  -- a manual-review case rather than a silently abandoned row.
  if v_state = 'exhausted' then
    insert into public.payment_cases (case_type, provider_order_id, purchase_table,
                                      open_reason, current_event)
    values ('manual_review', p_order, p_table, 'reconciliation-exhausted', null)
    on conflict do nothing;
  end if;

  return jsonb_build_object('ok', true, 'state', v_state, 'attempts', v_attempts);
end;
$function$;

revoke all on function public.payment_reconcile_complete(text,text,uuid,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.payment_reconcile_complete(text,text,uuid,text,text,integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. CASES. Monotonic: a lower-ranked event never rewrites a higher-ranked one.
-- ---------------------------------------------------------------------------
create or replace function public.payment_case_upsert(
  p_case_type   text,
  p_case_id     text,
  p_order       text,
  p_payment     text,
  p_event       text,
  p_rank        integer,
  p_amount      bigint,
  p_open_reason text default 'policy-decision-outstanding'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing public.payment_cases%rowtype;
  v_found    boolean := false;
begin
  if p_case_type not in ('refund','dispute','manual_review') then
    raise exception 'bad case type';
  end if;

  if p_case_id is not null then
    select * into v_existing from public.payment_cases
      where provider_case_id = p_case_id for update;
    v_found := found;
  end if;

  if not v_found then
    insert into public.payment_cases (case_type, provider_case_id, provider_order_id,
                                      provider_payment_id, current_event, current_rank,
                                      amount_minor, open_reason)
    values (p_case_type, p_case_id, p_order, p_payment, p_event,
            coalesce(p_rank, -1), p_amount, p_open_reason)
    on conflict do nothing;
    return jsonb_build_object('outcome', 'opened');
  end if;

  -- OUT-OF-ORDER IS ORDINARY, NOT AN ERROR. Razorpay does not guarantee
  -- ordering, so a `refund.created` after a `refund.processed` is expected and
  -- must be dropped rather than applied.
  if coalesce(p_rank, -1) <= v_existing.current_rank then
    return jsonb_build_object('outcome', 'stale', 'current_event', v_existing.current_event);
  end if;

  update public.payment_cases
     set current_event = p_event,
         current_rank  = p_rank,
         amount_minor  = coalesce(p_amount, amount_minor),
         provider_order_id = coalesce(provider_order_id, p_order),
         provider_payment_id = coalesce(provider_payment_id, p_payment),
         updated_at = now()
   where id = v_existing.id;

  return jsonb_build_object('outcome', 'advanced', 'from', v_existing.current_event,
                            'to', p_event);
end;
$function$;

revoke all on function public.payment_case_upsert(text,text,text,text,text,integer,bigint,text)
  from public, anon, authenticated;
grant execute on function public.payment_case_upsert(text,text,text,text,text,integer,bigint,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 9. THE ADMIN SURFACE. Two RPCs, both re-deriving `is_admin` server-side from
--    the caller's own JWT subject. The admin flag lives in a DB column the
--    client cannot write; it is never read from token metadata.
-- ---------------------------------------------------------------------------
create or replace function public.payment_recovery_overview()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_out jsonb;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'inbox', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
                from (select state, count(*) n from public.payment_webhook_events
                       group by state) s),
    'reconcile', (select coalesce(jsonb_object_agg(state, n), '{}'::jsonb)
                    from (select state, count(*) n from public.payment_reconcile_cursor
                           group by state) r),
    'cases', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
                from (select id, case_type, provider_case_id, provider_order_id,
                             provider_payment_id, amount_minor, current_event, status,
                             open_reason, resolution, resolution_note, opened_at, updated_at
                        from public.payment_cases
                       order by status, updated_at desc
                       limit 100) c),
    'stuck', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
                from (select id, event_name, event_class, provider_order_id,
                             provider_payment_id, state, attempts, last_error, received_at
                        from public.payment_webhook_events
                       where state in ('exhausted','conflict')
                       order by received_at desc
                       limit 50) e)
  ) into v_out;

  return v_out;
end;
$function$;

revoke all on function public.payment_recovery_overview() from public, anon;
grant execute on function public.payment_recovery_overview() to authenticated, service_role;

create or replace function public.payment_case_resolve(
  p_case_id    uuid,
  p_resolution text,
  p_note       text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows integer;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_resolution not in ('no_action','entitlement_revoked','refund_acknowledged',
                          'duplicate','other') then
    raise exception 'bad resolution';
  end if;

  -- RESOLVING A CASE IS A RECORD OF A DECISION, NOT AN ACTION. Nothing here
  -- issues a refund, revokes an entitlement or moves money; it writes down what
  -- a named admin decided, and when.
  update public.payment_cases
     set status = 'resolved',
         resolution = p_resolution,
         resolution_note = left(coalesce(p_note,''), 500),
         resolved_by = auth.uid(),
         resolved_at = now(),
         updated_at = now()
   where id = p_case_id and status = 'open';
  get diagnostics v_rows = row_count;

  return jsonb_build_object('ok', v_rows = 1);
end;
$function$;

revoke all on function public.payment_case_resolve(uuid,text,text) from public, anon;
grant execute on function public.payment_case_resolve(uuid,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. THE SCHEDULER. pg_cron -> pg_net -> the worker, with the credential read
--     from Vault at call time and never written into this file.
--
--     THE KEY IS CHOSEN BY SHAPE, NOT BY NAME, and that is not a preference:
--     `ops_watch_pick_key()` exists because copying a name preference produced
--     a watchdog that detected for ever and announced never. It is REUSED here
--     rather than re-derived, so the two cannot drift.
--
--     THE WORKER VERIFIES THE TOKEN CRYPTOGRAPHICALLY — a constant-time
--     comparison against the service credential it already holds. A decoded
--     `role` claim is a CLAIM: anyone can mint a JWT that says `service_role`,
--     and reading one as proof would make this endpoint world-writable. The
--     shape of a token is not its authenticity.
--
--     PRE-DEPLOY CHECK, and it is not optional: call the endpoint once with the
--     key this picker returns and confirm 200 rather than 401. The watchdog's
--     own header records why — the pairing was wrong on this project and only
--     calling it found out.
-- ---------------------------------------------------------------------------
create or replace function public.payment_recovery_tick()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_key   text;
  v_url   text := 'https://bqwttemnnoexadpwifcj.supabase.co/functions/v1/payment-recovery';
  v_req   bigint;
  v_added integer;
begin
  perform pg_advisory_xact_lock(hashtext('payment_recovery_tick'));

  v_added := public.payment_reconcile_enqueue(200);

  v_key := public.ops_watch_pick_key();
  if v_key is null then
    raise warning 'payment_recovery_tick: no service credential available';
    return jsonb_build_object('enqueued', v_added, 'dispatched', false);
  end if;

  select net.http_post(
           url     := v_url,
           headers := jsonb_build_object('Content-Type', 'application/json',
                                         'Authorization', 'Bearer ' || v_key),
           body    := jsonb_build_object('source', 'cron'),
           timeout_milliseconds := 55000
         ) into v_req;

  return jsonb_build_object('enqueued', v_added, 'dispatched', true, 'request_id', v_req);
end;
$function$;

revoke all on function public.payment_recovery_tick() from public, anon, authenticated;

-- Every two minutes: often enough that a missed delivery is caught while the
-- customer is still on the screen, rare enough that an idle project does ~720
-- no-op ticks a day rather than 1,440.
select cron.unschedule('payment-recovery')
 where exists (select 1 from cron.job where jobname = 'payment-recovery');

select cron.schedule('payment-recovery', '*/2 * * * *',
                     $$select public.payment_recovery_tick();$$);

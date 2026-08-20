-- P1 — Creator Program (Track A / RazorpayX) payout concurrency safety.
--
-- PREPARED, NOT APPLIED. This file lives under parked/ ON PURPOSE: Lovable
-- Cloud auto-applies anything under supabase/migrations/ when it builds main,
-- and this migration must not run against production until the owner approves
-- the money-path change. Promotion is a deliberate copy into
-- supabase/migrations/20260820090000_payout_concurrency_safety.sql followed by
-- an explicit apply — see parked/payout-safety/README.md.
--
-- WHAT IT FIXES. On current main the dispatch path can pay a creator/subscriber
-- more than once:
--   1. claim_payout_batch is a SELECT — it does not mark rows claimed, so two
--      concurrent dispatch runs (an admin double-tap, or a retry after the
--      60s edge timeout) both read the same 'queued' rows and both pay them.
--   2. mark_payout_result only transitions FROM 'queued'; the dispatcher's mark
--      call is wrapped in `.catch(() => {})`, so a mark that fails after a
--      successful payout leaves the row 'queued' → re-claimed → paid again.
--   3. createRazorpayPayout sends no idempotency key, so a resend is a second
--      real payout at the provider.
--
-- WHAT IT CHANGES. Additive and reversible (see the rollback block at the end,
-- kept as a comment). A 'processing' state + an atomic claim make one row
-- claimable by exactly one worker; a guarded mark makes 'paid' terminal and
-- idempotent; a reaper self-heals crashed workers; an 'unknown' state parks a
-- genuinely-undetermined payout for reconciliation instead of guessing. The
-- application side pairs this with an X-Payout-Idempotency header so a retry
-- can never become a second payout at RazorpayX.
--
-- NOTHING about amounts, eligibility, percentages, scheduling, account
-- selection, or the creator_payouts ledger is touched. This is concurrency
-- only.

begin;

-- ---------------------------------------------------------------------------
-- 1. NEW STATES + BOOKKEEPING COLUMNS.
--    'processing' — atomically claimed, an external payout is in flight.
--    'unknown'    — retries exhausted with the true provider state undetermined;
--                   requires manual reconciliation, NEVER auto-repaid.
--    claimed_at   — when the row entered 'processing' (drives the reaper).
--    attempts     — how many times it has been claimed (bounds the retry loop).
-- ---------------------------------------------------------------------------
alter table public.payout_queue
  add column if not exists claimed_at timestamptz,
  add column if not exists attempts   int not null default 0;

alter table public.payout_queue drop constraint if exists payout_queue_status_check;
alter table public.payout_queue
  add constraint payout_queue_status_check
  check (status in ('queued', 'processing', 'no_method', 'paid', 'failed', 'unknown'));

-- The reaper scans only in-flight rows; a partial index keeps that cheap.
create index if not exists payout_queue_processing_idx
  on public.payout_queue (claimed_at)
  where status = 'processing';

-- DETECTABLE INVARIANT: one provider payout id can belong to at most one queue
-- row. If a bug ever recorded the same RazorpayX payout against two rows, this
-- unique index turns that into a loud constraint violation rather than a silent
-- double-count. NULLs are allowed to repeat (unpaid rows carry no id).
create unique index if not exists payout_queue_provider_payout_id_uq
  on public.payout_queue (provider_payout_id)
  where provider_payout_id is not null;

-- ---------------------------------------------------------------------------
-- 2. ATOMIC CLAIM. queued → processing in one statement, under row locks that
--    a concurrent claim SKIPs. This is the core guarantee:
--        ONE PAYOUT → ONE ACTIVE PROCESSOR.
--    FOR UPDATE SKIP LOCKED is the canonical Postgres work-queue claim: two
--    workers running this at the same instant partition the rows between them
--    and never overlap. attempts is incremented so the reaper can bound retries.
-- ---------------------------------------------------------------------------
create or replace function public.claim_payout_batch(_limit int default 20)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  with picked as (
    select q.id
      from payout_queue q
     where q.status = 'queued'
     order by q.created_at
     for update skip locked
     limit greatest(1, least(_limit, 50))
  ),
  claimed as (
    update payout_queue q
       set status     = 'processing',
           claimed_at = now(),
           attempts   = q.attempts + 1,
           updated_at = now()
      from picked
     where q.id = picked.id
    returning q.id, q.recipient_id, q.amount_paise, q.kind
  )
  select jsonb_build_object(
           'id', c.id, 'recipientId', c.recipient_id, 'amountPaise', c.amount_paise,
           'kind', c.kind, 'vpa', pm.vpa)
    from claimed c
    left join payout_methods pm on pm.user_id = c.recipient_id;
$$;
revoke all on function public.claim_payout_batch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. GUARDED, IDEMPOTENT MARK. Only a 'processing' row can move to a terminal
--    state, and it reports whether it actually moved (so the dispatcher stops
--    swallowing mark failures). A row already 'paid' is untouched — marking a
--    second time is a no-op, so a duplicate mark can never double-count.
--    Returns { updated, status } — updated=false means the row was not in
--    'processing' (already terminal, or reaped away), which the caller logs.
-- ---------------------------------------------------------------------------
create or replace function public.mark_payout_result(
  _id uuid,
  _status text,
  _provider_payout_id text default null,
  _error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_status text;
begin
  if _status not in ('paid', 'failed', 'no_method') then
    return jsonb_build_object('updated', false, 'status', null, 'reason', 'illegal target status');
  end if;

  update payout_queue
     set status             = _status,
         provider_payout_id = coalesce(_provider_payout_id, provider_payout_id),
         error              = left(coalesce(_error, error), 300),
         updated_at         = now()
   where id = _id
     and status = 'processing'
  returning status into new_status;

  if new_status is null then
    -- Not in 'processing' (already terminal or reaped). Report the truth.
    select status into new_status from payout_queue where id = _id;
    return jsonb_build_object('updated', false, 'status', new_status);
  end if;
  return jsonb_build_object('updated', true, 'status', new_status);
end;
$$;
revoke all on function public.mark_payout_result(uuid, text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE REAPER. A worker that claims a row then crashes leaves it stuck in
--    'processing'. This requeues rows whose claim is older than the timeout so
--    they can be retried — SAFELY, because the dispatcher re-POSTs with the
--    same X-Payout-Idempotency key and RazorpayX returns the original payout
--    rather than making a second one. Rows that have exhausted their attempts
--    move to 'unknown' (true provider state undetermined) for manual
--    reconciliation instead of being guessed 'failed' — because a payout that
--    silently succeeded must never be re-sent on a guess. Returns how many rows
--    it moved, per bucket, so a run can report its self-healing.
-- ---------------------------------------------------------------------------
create or replace function public.reap_stuck_payouts(
  _older_than_minutes int default 15,
  _max_attempts int default 5
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with expired as (
    update payout_queue q
       set status     = case when q.attempts >= greatest(1, _max_attempts)
                             then 'unknown' else 'queued' end,
           error      = case when q.attempts >= greatest(1, _max_attempts)
                             then left(coalesce(q.error, '') ||
                                  ' [reaper: attempts exhausted, reconcile against provider by reference_id]', 300)
                             else q.error end,
           claimed_at = case when q.attempts >= greatest(1, _max_attempts)
                             then q.claimed_at else null end,
           updated_at = now()
     where q.status = 'processing'
       and q.claimed_at < now() - make_interval(mins => greatest(1, _older_than_minutes))
    returning q.status as new_status
  )
  select jsonb_build_object(
           'requeued', count(*) filter (where new_status = 'queued'),
           'unknown',  count(*) filter (where new_status = 'unknown')
         )
    from expired;
$$;
revoke all on function public.reap_stuck_payouts(int, int) from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run only if the change must be reverted BEFORE any row has used a
-- new state; see README for the caveat about rows already in 'processing' or
-- 'unknown'). This restores the pre-P1 definitions verbatim.
--
-- begin;
--   -- Restore the SELECT-only claim and the queued-only, void-returning mark.
--   create or replace function public.claim_payout_batch(_limit int default 20)
--   returns setof jsonb language sql security definer set search_path = public as $$
--     select jsonb_build_object('id', q.id, 'recipientId', q.recipient_id,
--              'amountPaise', q.amount_paise, 'kind', q.kind, 'vpa', pm.vpa)
--       from payout_queue q
--       left join payout_methods pm on pm.user_id = q.recipient_id
--      where q.status = 'queued' order by q.created_at
--      limit greatest(1, least(_limit, 50));
--   $$;
--   revoke all on function public.claim_payout_batch(int) from public, anon, authenticated;
--   drop function if exists public.reap_stuck_payouts(int, int);
--   -- Any rows left in 'processing'/'unknown' must be resolved by hand first,
--   -- then the status constraint can be narrowed back if desired. Leaving the
--   -- wider constraint and the new columns in place is harmless.
-- commit;

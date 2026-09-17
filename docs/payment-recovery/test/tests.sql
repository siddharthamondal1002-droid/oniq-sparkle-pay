-- Behavioural tests for docs/payment-recovery/migration.sql. These EXECUTE the
-- SQL; nothing here matches strings against the file. Concurrency is exercised
-- from real parallel sessions by the runner, not from this script.
\set ON_ERROR_STOP on

-- ===========================================================================
-- T1  DEDUP BY BODY, WHATEVER THE HEADER SAID
-- ===========================================================================
do $$
declare a jsonb; b jsonb; c jsonb; n integer;
begin
  a := public.payment_inbox_record('evt_1', repeat('a',64), 'payment.captured', 'paid',
                                   'order_1','pay_1',null,null, 4900, 'captured', now());
  b := public.payment_inbox_record('evt_1', repeat('a',64), 'payment.captured', 'paid',
                                   'order_1','pay_1',null,null, 4900, 'captured', now());
  -- Same bytes, no event-id header at all. A single dedup_key would have made
  -- this a second row and paid the order twice.
  c := public.payment_inbox_record(null,    repeat('a',64), 'payment.captured', 'paid',
                                   'order_1','pay_1',null,null, 4900, 'captured', now());
  perform public.t_assert(a->>'outcome' = 'recorded',  'first delivery records: '||a::text);
  perform public.t_assert(b->>'outcome' = 'duplicate', 'same id+body is a duplicate: '||b::text);
  perform public.t_assert(c->>'outcome' = 'duplicate', 'same body, no header, is a duplicate: '||c::text);
  select count(*) into n from public.payment_webhook_events where body_sha256 = repeat('a',64);
  perform public.t_assert(n = 1, 'exactly one row for one body, got '||n);
  raise notice 'T1 ok  dedup by body across header presence';
end $$;

-- A body first seen WITHOUT an id, then redelivered WITH one: the id is filled
-- in rather than a second row created.
do $$
declare a jsonb; b jsonb; v text;
begin
  a := public.payment_inbox_record(null, repeat('b',64), 'payment.captured','paid',
                                   'order_b','pay_b',null,null, 100,'captured', now());
  b := public.payment_inbox_record('evt_b', repeat('b',64), 'payment.captured','paid',
                                   'order_b','pay_b',null,null, 100,'captured', now());
  perform public.t_assert(b->>'outcome' = 'duplicate', 'still a duplicate');
  select provider_event_id into v from public.payment_webhook_events where body_sha256 = repeat('b',64);
  perform public.t_assert(v = 'evt_b', 'the late header is adopted, got '||coalesce(v,'null'));
  raise notice 'T1b ok  late event id adopted without a second row';
end $$;

-- ===========================================================================
-- T2  ONE EVENT ID, TWO BODIES -> DURABLE CONFLICT + ALERT
-- ===========================================================================
do $$
declare r jsonb; st text; stored text; n integer;
begin
  r := public.payment_inbox_record('evt_1', repeat('c',64), 'payment.captured','paid',
                                   'order_1','pay_X',null,null, 9900,'captured', now());
  perform public.t_assert(r->>'outcome' = 'conflict', 'mismatched body conflicts: '||r::text);
  select state, conflict_sha256 into st, stored
    from public.payment_webhook_events where provider_event_id = 'evt_1';
  perform public.t_assert(st = 'conflict', 'the original row is marked conflict, got '||st);
  perform public.t_assert(stored = repeat('c',64), 'the incoming digest is kept as evidence');
  select count(*) into n from public.ops_alerts
   where signal = 'payment_inbox_conflict' and resolved_at is null;
  perform public.t_assert(n = 1, 'one open conflict alert, got '||n);
  perform public.t_assert(
    (select notified_at is null from public.ops_alerts where signal='payment_inbox_conflict'),
    'opening an alert does not claim it was delivered');
  raise notice 'T2 ok  conflict recorded, alerted, not claimed as delivered';
end $$;

-- ===========================================================================
-- T3  A LEASED WORKER CANNOT UNDO A CONFLICT
-- ===========================================================================
do $$
declare v_id uuid; v_lease uuid; r jsonb;
begin
  perform public.payment_inbox_record('evt_3', repeat('d',64), 'payment.captured','paid',
                                      'order_3','pay_3',null,null, 100,'captured', now());
  select id into v_id from public.payment_webhook_events where provider_event_id='evt_3';
  select lease_token into v_lease from public.payment_inbox_claim(10, 120) where id = v_id;
  perform public.t_assert(v_lease is not null, 'the row was claimed');

  -- A second body arrives under the same id while the worker is mid-flight.
  perform public.payment_inbox_record('evt_3', repeat('e',64), 'payment.captured','paid',
                                      'order_3','pay_3',null,null, 100,'captured', now());
  r := public.payment_inbox_complete(v_id, v_lease, 'done', null, 60);
  perform public.t_assert(r->>'ok' = 'false', 'the stale completion is refused: '||r::text);
  perform public.t_assert((select state from public.payment_webhook_events where id=v_id) = 'conflict',
                          'the conflict stands');
  raise notice 'T3 ok  conflict survives a worker that was already holding the row';
end $$;

-- ===========================================================================
-- T4  THE FENCE: state + token + UNEXPIRED lease, and attempts spent at claim
-- ===========================================================================
do $$
declare v_id uuid; v_lease uuid; v_att integer; r jsonb;
begin
  perform public.payment_inbox_record('evt_4', repeat('f',64), 'payment.captured','paid',
                                      'order_4','pay_4',null,null, 100,'captured', now());
  select id into v_id from public.payment_webhook_events where provider_event_id='evt_4';
  perform public.t_assert((select attempts from public.payment_webhook_events where id=v_id) = 0,
                          'a recorded row starts at zero attempts');

  select lease_token, attempts into v_lease, v_att from public.payment_inbox_claim(10,120) where id=v_id;
  perform public.t_assert(v_att = 1, 'the attempt is spent at CLAIM, got '||v_att);

  r := public.payment_inbox_complete(v_id, gen_random_uuid(), 'done', null, 60);
  perform public.t_assert(r->>'reason' = 'lease-lost', 'a wrong token is refused');

  update public.payment_webhook_events set lease_expires_at = now() - interval '1 minute'
   where id = v_id;
  r := public.payment_inbox_complete(v_id, v_lease, 'done', null, 60);
  perform public.t_assert(r->>'reason' = 'lease-lost',
                          'the right token with an EXPIRED lease is refused: '||r::text);
  raise notice 'T4 ok  completion fenced on all three of state, token, expiry';
end $$;

-- A crashing worker cannot retry for ever: every claim costs an attempt, and
-- the claim query itself refuses a row at the bound.
do $$
declare v_id uuid; i integer; n integer;
begin
  perform public.payment_inbox_record('evt_5', repeat('1',64), 'payment.captured','paid',
                                      'order_5','pay_5',null,null, 100,'captured', now());
  select id into v_id from public.payment_webhook_events where provider_event_id='evt_5';
  for i in 1..20 loop
    perform public.payment_inbox_claim(10, 1);                      -- claim and "crash"
    update public.payment_webhook_events
       set lease_expires_at = now() - interval '1 second', next_due_at = now() where id = v_id;
  end loop;
  select attempts into n from public.payment_webhook_events where id = v_id;
  perform public.t_assert(n <= public.payment_recovery_max_attempts(),
                          'attempts stop at the bound, got '||n);
  raise notice 'T4b ok  a crashing worker is bounded at % attempts', n;
end $$;

-- ===========================================================================
-- T5  THE REAPER: requeue below the bound, exhaust on the final attempt
-- ===========================================================================
do $$
declare v_id uuid; v_last uuid; r jsonb; st text; n integer;
begin
  perform public.payment_inbox_record('evt_6', repeat('2',64), 'payment.captured','paid',
                                      'order_6','pay_6',null,null, 100,'captured', now());
  select id into v_id from public.payment_webhook_events where provider_event_id='evt_6';
  perform public.payment_inbox_claim(10, 120);
  update public.payment_webhook_events set lease_expires_at = now() - interval '1 s' where id=v_id;
  r := public.payment_inbox_reap();
  select state into st from public.payment_webhook_events where id=v_id;
  perform public.t_assert(st = 'pending', 'an early expiry is requeued, got '||st);
  perform public.t_assert((select next_due_at > now() from public.payment_webhook_events where id=v_id),
                          'requeue backs off rather than spinning');

  -- Final attempt, then the worker vanishes.
  update public.payment_webhook_events
     set attempts = public.payment_recovery_max_attempts(), state='processing',
         lease_token = gen_random_uuid(), lease_expires_at = now() - interval '1 s'
   where id = v_id;
  r := public.payment_inbox_reap();
  select state into st from public.payment_webhook_events where id=v_id;
  perform public.t_assert(st = 'exhausted', 'the final expiry exhausts, got '||st);
  select count(*) into n from public.ops_alerts
   where signal='payment_inbox_exhausted' and resolved_at is null;
  perform public.t_assert(n = 1, 'exhaustion raises one open alert, got '||n);
  select count(*) into n from public.payment_cases
   where provider_order_id='order_6' and case_type='manual_review';
  perform public.t_assert(n = 1, 'exhaustion opens a manual review case, got '||n);
  raise notice 'T5 ok  reaper requeues, then exhausts with an alert and a case';
end $$;

-- ===========================================================================
-- T6  ENQUEUE FAIRNESS ACROSS MORE ROWS THAN ONE BATCH
-- ===========================================================================
do $$
declare v1 integer; v2 integer; v3 integer; n integer;
begin
  insert into public.story_purchases (user_id, provider, provider_order_id, status, created_at)
  select gen_random_uuid(), 'razorpay', 'ord_'||g, 'created', now() - interval '1 hour'
    from generate_series(1,250) g;

  v1 := public.payment_reconcile_enqueue(200);
  v2 := public.payment_reconcile_enqueue(200);
  v3 := public.payment_reconcile_enqueue(200);
  perform public.t_assert(v1 = 200, 'first batch takes 200, got '||v1);
  -- Without the anti-join this is 0 for ever and rows 201..250 never reconcile.
  perform public.t_assert(v2 = 50,  'the second batch reaches the REST, got '||v2);
  perform public.t_assert(v3 = 0,   'nothing is left to enqueue, got '||v3);
  select count(*) into n from public.payment_reconcile_cursor where purchase_table='story_purchases';
  perform public.t_assert(n = 250, 'every purchase is queued exactly once, got '||n);
  raise notice 'T6 ok  250 rows fully enqueued in two batches, none starved';
end $$;

-- A failed-looking purchase is exactly the missed-delivery shape, so it is
-- included; a paid one is not.
do $$
declare n integer;
begin
  insert into public.plan_purchases (user_id, provider, provider_order_id, status, created_at)
  values (gen_random_uuid(),'razorpay','ord_failed','failed', now()-interval '1 hour');
  insert into public.plan_purchases (user_id, provider, provider_order_id,
                                     provider_payment_id, status, created_at)
  values (gen_random_uuid(),'razorpay','ord_paid','pay_ok','paid', now()-interval '1 hour');
  perform public.payment_reconcile_enqueue(200);
  select count(*) into n from public.payment_reconcile_cursor where provider_order_id='ord_failed';
  perform public.t_assert(n = 1, 'a failed attempt is still reconciled');
  select count(*) into n from public.payment_reconcile_cursor where provider_order_id='ord_paid';
  perform public.t_assert(n = 0, 'a bound purchase is left alone');
  raise notice 'T6b ok  failed included, already-bound excluded';
end $$;

-- ===========================================================================
-- T7  AGED ROWS GET VISIBILITY RATHER THAN VANISHING
-- ===========================================================================
do $$
declare v integer; n integer;
begin
  insert into public.video_purchases (user_id, provider, provider_order_id, status, created_at)
  values (gen_random_uuid(),'razorpay','ord_old','created', now() - interval '90 days');
  perform public.payment_reconcile_enqueue(200);
  select count(*) into n from public.payment_reconcile_cursor where provider_order_id='ord_old';
  perform public.t_assert(n = 0, 'outside the window, the reconciler leaves it');

  v := public.payment_reconcile_backfill_aged(500);
  select count(*) into n from public.payment_cases
   where provider_order_id='ord_old' and case_type='manual_review';
  perform public.t_assert(n = 1, 'but it becomes a manual review case, got '||n);
  perform public.payment_reconcile_backfill_aged(500);
  select count(*) into n from public.payment_cases where provider_order_id='ord_old';
  perform public.t_assert(n = 1, 'and a second pass does not duplicate it, got '||n);
  raise notice 'T7 ok  aged unresolved purchase retained as manual review';
end $$;

-- ===========================================================================
-- T8  CASES: opened, advanced, out-of-order, conflicting, reopened
-- ===========================================================================
do $$
declare a jsonb; b jsonb; c jsonb; cid uuid; st text; n integer;
begin
  a := public.payment_case_upsert('refund','rfnd_1','order_9','pay_9','refund.created',1,2500);
  perform public.t_assert(a->>'outcome' = 'opened', 'first event opens: '||a::text);
  cid := (a->>'id')::uuid;

  b := public.payment_case_upsert('refund','rfnd_1','order_9','pay_9','refund.processed',3,2500);
  perform public.t_assert(b->>'outcome' = 'advanced', 'a later rank advances: '||b::text);

  -- Razorpay does not guarantee order; the earlier event arriving second must
  -- not walk the case backwards.
  c := public.payment_case_upsert('refund','rfnd_1','order_9','pay_9','refund.created',1,2500);
  perform public.t_assert(c->>'outcome' = 'stale', 'the out-of-order event is dropped: '||c::text);
  perform public.t_assert(
    (select current_event from public.payment_cases where id=cid) = 'refund.processed',
    'the case still holds the later event');

  select count(*) into n from public.payment_case_events where case_id = cid;
  perform public.t_assert(n = 3, 'every event is in the history, got '||n);
  raise notice 'T8 ok  opened, advanced, out-of-order dropped but recorded';
end $$;

-- Linkage arrives later, and only fills what is empty.
do $$
declare cid uuid; u uuid := gen_random_uuid(); v uuid;
begin
  cid := (public.payment_case_upsert('dispute','disp_1',null,'pay_10','dispute.created',1,500)->>'id')::uuid;
  perform public.payment_case_upsert('dispute','disp_1','order_10','pay_10','dispute.under_review',2,500,
                                     u, 'story_purchases');
  select user_id into v from public.payment_cases where id=cid;
  perform public.t_assert(v = u, 'the verified binding fills the empty user');
  perform public.payment_case_upsert('dispute','disp_1','order_10','pay_10','dispute.won',3,500,
                                     gen_random_uuid(), 'plan_purchases');
  select user_id into v from public.payment_cases where id=cid;
  perform public.t_assert(v = u, 'a later claim cannot overwrite an established link');
  raise notice 'T8b ok  linkage filled once, never rewritten';
end $$;

-- Two terminal events of the SAME rank are not a race to be settled by arrival.
do $$
declare cid uuid; r jsonb; st text;
begin
  cid := (public.payment_case_upsert('dispute','disp_2','order_11','pay_11','dispute.won',4,700)->>'id')::uuid;
  r := public.payment_case_upsert('dispute','disp_2','order_11','pay_11','dispute.lost',4,700);
  perform public.t_assert(r->>'outcome' = 'conflict', 'same-rank disagreement is a conflict: '||r::text);
  select status into st from public.payment_cases where id=cid;
  perform public.t_assert(st = 'needs_provider_refresh',
                          'and it waits for a person or a fresh read, got '||st);
  raise notice 'T8c ok  won/lost at one rank is not decided by delivery order';
end $$;

-- A resolved case reopens on material adverse news, keeping its history.
do $$
declare cid uuid; r jsonb; st text; res text; n integer;
begin
  cid := (public.payment_case_upsert('dispute','disp_3','order_12','pay_12','dispute.created',1,800)->>'id')::uuid;
  set local test.uid = '00000000-0000-0000-0000-0000000000aa';
  insert into public.profiles (id, is_admin) values ('00000000-0000-0000-0000-0000000000aa', true)
    on conflict (id) do update set is_admin = true;
  perform public.payment_case_resolve(cid, 'no_action', 'closed after review with the provider');
  perform public.t_assert((select status from public.payment_cases where id=cid) = 'resolved',
                          'the case closes');

  r := public.payment_case_upsert('dispute','disp_3','order_12','pay_12','dispute.lost',4,800,
                                  null,null,'policy-decision-outstanding', true);
  perform public.t_assert(r->>'outcome' = 'reopened', 'material adverse news reopens: '||r::text);
  select status, resolution into st, res from public.payment_cases where id=cid;
  perform public.t_assert(st = 'open' and res is null, 'and clears the stale resolution');
  select count(*) into n from public.payment_case_events where case_id=cid and kind='resolved';
  perform public.t_assert(n = 1, 'while the resolution stays in the history, got '||n);
  raise notice 'T8d ok  reopened, with the previous decision preserved';
end $$;

-- The history is append-only even to the owner.
do $$
declare failed boolean := false;
begin
  begin
    update public.payment_case_events set detail = '{"tampered":true}'::jsonb where id > 0;
  exception when others then failed := true; end;
  perform public.t_assert(failed, 'case history refuses an UPDATE');
  failed := false;
  begin
    delete from public.payment_case_events where id > 0;
  exception when others then failed := true; end;
  perform public.t_assert(failed, 'case history refuses a DELETE');
  raise notice 'T8e ok  case history is append-only';
end $$;

-- ===========================================================================
-- T9  ACCESS. NULL subject fails closed, and it fails BEFORE is_admin is asked.
-- ===========================================================================
do $$
declare code text; ok boolean := false;
begin
  reset test.uid;
  begin
    perform public.payment_recovery_overview();
  exception when others then get stacked diagnostics code = returned_sqlstate;
    ok := (code = '42501');
  end;
  perform public.t_assert(ok, 'an unauthenticated overview is forbidden, got '||coalesce(code,'none'));
end $$;

do $$
declare ok boolean := false; code text;
begin
  set local test.uid = '00000000-0000-0000-0000-0000000000bb';
  insert into public.profiles (id, is_admin) values ('00000000-0000-0000-0000-0000000000bb', false)
    on conflict (id) do nothing;
  begin
    perform public.payment_recovery_overview();
  exception when others then get stacked diagnostics code = returned_sqlstate; ok := (code='42501');
  end;
  perform public.t_assert(ok, 'a signed-in non-admin is forbidden');
end $$;

do $$
declare v jsonb;
begin
  set local test.uid = '00000000-0000-0000-0000-0000000000aa';
  v := public.payment_recovery_overview();
  perform public.t_assert(v ? 'inbox' and v ? 'cases' and v ? 'stuck', 'an admin gets the overview');
  raise notice 'T9 ok  overview: null forbidden, non-admin forbidden, admin allowed';
end $$;

-- A resolution needs a reason, and a bounded one.
do $$
declare cid uuid; ok boolean := false;
begin
  set local test.uid = '00000000-0000-0000-0000-0000000000aa';
  cid := (public.payment_case_upsert('refund','rfnd_9','order_13','pay_13','refund.created',1,100)->>'id')::uuid;
  begin perform public.payment_case_resolve(cid, 'no_action', 'short');
  exception when others then ok := true; end;
  perform public.t_assert(ok, 'a one-word note is refused');
  ok := false;
  begin perform public.payment_case_resolve(cid, 'no_action', repeat('x', 501));
  exception when others then ok := true; end;
  perform public.t_assert(ok, 'an unbounded note is refused');
  ok := false;
  begin perform public.payment_case_resolve(cid, 'issue_refund', 'a plausible sounding note');
  exception when others then ok := true; end;
  perform public.t_assert(ok, 'a resolution outside the closed list is refused');
  raise notice 'T9b ok  resolution notes bounded, resolutions closed';
end $$;

-- The GRANT lines, checked by asking the catalogue rather than reading the file.
do $$
begin
  perform public.t_assert(not has_function_privilege('anon',
    'public.payment_inbox_record(text,text,text,text,text,text,text,text,bigint,text,timestamptz)','execute'),
    'anon cannot record a webhook');
  perform public.t_assert(not has_function_privilege('authenticated',
    'public.payment_inbox_record(text,text,text,text,text,text,text,text,bigint,text,timestamptz)','execute'),
    'authenticated cannot record a webhook');
  perform public.t_assert(not has_function_privilege('authenticated',
    'public.payment_case_upsert(text,text,text,text,text,integer,bigint,uuid,text,text,boolean)','execute'),
    'authenticated cannot write a case directly');
  perform public.t_assert(not has_function_privilege('authenticated',
    'public.payment_recovery_tick()','execute'), 'authenticated cannot run the tick');
  perform public.t_assert(has_function_privilege('authenticated',
    'public.payment_recovery_overview()','execute'), 'the admin RPC is reachable and re-checks inside');
  perform public.t_assert(not has_table_privilege('authenticated','public.payment_webhook_events','select'),
    'no direct read of the inbox');
  perform public.t_assert(not has_table_privilege('anon','public.payment_cases','select'),
    'no direct read of cases');
  perform public.t_assert(has_table_privilege('service_role','public.payment_cases','insert'),
    'the worker can write');
  perform public.t_assert(
    (select relrowsecurity from pg_class where oid='public.payment_webhook_events'::regclass),
    'RLS is on');
  perform public.t_assert(
    (select count(*) from pg_policies where tablename='payment_webhook_events') = 0,
    'and no policy opens it');
  raise notice 'T9c ok  grants, RLS and the absence of policies';
end $$;

-- ===========================================================================
-- T10  NO SCHEDULE IS CREATED BY LOADING THIS FILE
-- ===========================================================================
do $$
begin
  perform public.t_assert(
    (select count(*) from pg_proc where proname='payment_recovery_setup_schedule') = 1,
    'the setup step exists');
  perform public.t_assert(to_regclass('cron.job') is null,
    'and nothing in this file created a cron schema or job');
  raise notice 'T10 ok  tick defined, schedule NOT created';
end $$;

select 'ALL SQL TESTS PASSED' as result;

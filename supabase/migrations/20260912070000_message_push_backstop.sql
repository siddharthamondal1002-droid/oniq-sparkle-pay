-- A message that COMMITS gets a push, whatever the sender's client did.
--
-- CLAUDE.md recorded this on 2026-09-07 and left it: "`sendPush` is invoked
-- from the SENDER's client. If that client never runs the line — a closed tab,
-- a dropped request, an early throw — no push exists and nothing anywhere
-- records that it did not happen, because `push.ts` writes a row only on
-- FAILURE." Nothing has ever recorded a push being DELIVERED either, which is
-- why the size of that gap cannot be measured retroactively. That absence is
-- the argument for this, not a number.
--
-- IT IS A BACKSTOP, NOT A REPLACEMENT, and `skipPush` is why. Sending five
-- photos inserts five rows and deliberately pushes ONCE, as "📎 5 items". A
-- trigger that pushed per row would turn one buzz into five — a regression
-- dressed as a fix. So the client keeps the immediate path, with its batching
-- intact, and the server only catches what the client never sent.
--
-- COVERAGE IS PER CONVERSATION, WHICH IS WHAT MAKES IT NEED NO CLIENT CHANGE.
-- Any completed delivery stamps the conversation; a message is uncovered only
-- if it is older than the grace period AND newer than that stamp. The batch's
-- single push covers all five rows for free, because all five predate it. Not
-- one line of the chat route moves, which matters: it has 9 sendPush call
-- sites and every edit there is a chance to break the path that works.

-- ---------------------------------------------------------------------------
-- 1. WHEN A CONVERSATION LAST HAD A PUSH ATTEMPTED FOR IT.
--
--    ATTEMPTED, not delivered — and the distinction is load-bearing. Measured
--    2026-09-07: 8 of 19 active conversations have ZERO members with a device
--    token, so a "stamp only on success" rule would leave them permanently
--    uncovered and re-attempt every single minute, for ever. The backstop asks
--    "did anything try?", which is the question it can actually answer.
-- ---------------------------------------------------------------------------
create table if not exists public.message_push_state (
  conversation_id   uuid primary key references public.conversations(id) on delete cascade,
  last_attempted_at timestamptz not null default now(),
  attempts          bigint      not null default 0
);

alter table public.message_push_state enable row level security;
-- No policy: the service role writes it and nothing else reads it. A client
-- that could write here could silence its own recipient's notifications.

grant select, insert, update on public.message_push_state to service_role;

-- SEED EVERY EXISTING CONVERSATION AS COVERED, or the first sweep treats the
-- entire recent history as unannounced and sends a push for each one. Nobody
-- wants a notification about a message from two days ago, and "catch up on the
-- backlog" is not what a backstop is for — it exists to cover the NEXT failure.
insert into public.message_push_state (conversation_id, last_attempted_at, attempts)
select c.id, now(), 0 from public.conversations c
on conflict (conversation_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. WHAT THE CLIENT MISSED.
--
--    Bounded by construction: one row per conversation, newest first, capped.
--    A backlog cannot become a storm, and the cap is visible in the result so
--    a run that hits it says so rather than looking complete.
-- ---------------------------------------------------------------------------
create or replace function public.message_push_pending(
  grace_seconds integer default 60,
  max_conversations integer default 20
)
returns table (
  conversation_id uuid,
  sender_id       uuid,
  missed          bigint,
  newest_type     text,
  newest_content  text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with uncovered as (
    select m.*
      from public.messages m
      left join public.message_push_state s on s.conversation_id = m.conversation_id
     where m.created_at < now() - make_interval(secs => grace_seconds)
       and m.created_at > now() - interval '24 hours'
       and coalesce(m.is_deleted, false) = false
       -- AI replies are excluded DELIBERATELY. The backstop exists to catch a
       -- human message the sender's client failed to announce; making Ting's
       -- replies start buzzing people is a product change nobody asked for.
       and m.is_ai = false
       and (s.last_attempted_at is null or m.created_at > s.last_attempted_at)
  ),
  ranked as (
    select u.*, row_number() over (partition by u.conversation_id
                                   order by u.created_at desc) as rn,
           count(*)   over (partition by u.conversation_id)    as missed_in_convo
      from uncovered u
  )
  select r.conversation_id, r.sender_id, r.missed_in_convo, r.type, r.content
    from ranked r
   where r.rn = 1
   order by r.created_at asc
   limit max_conversations;
$function$;

revoke all on function public.message_push_pending(integer, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE SWEEP.
--
--    IT STAMPS AT DISPATCH, NOT ON DELIVERY, and that ordering is the storm
--    guard. `net.http_post` returns a request id, not a result — the delivery
--    completes seconds later — so a sweep that waited for send-push to stamp
--    would fire again on the next tick and again on the one after, sending the
--    same conversation a push per minute until the first reply landed. Stamping
--    first costs at most ONE missed retry (the stamp says "attempted", which is
--    true) and removes an unbounded duplicate.
-- ---------------------------------------------------------------------------
create or replace function public.message_push_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  k_grace   constant integer := 60;   -- a slow client still beats the backstop
  k_max     constant integer := 20;   -- ~12 messages a day; this is headroom, not a limit
  r         record;
  v_key     text;
  v_url     text;
  v_preview text;
  n         integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('message_push_sweep'));

  v_key := public.ops_watch_pick_key();
  if v_key is null then
    raise warning 'message_push_sweep: no verifiable service key in vault';
    return jsonb_build_object('sent', 0, 'reason', 'no key');
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets
    where name = 'project_url' limit 1;
  v_url := coalesce(v_url, 'https://bqwttemnnoexadpwifcj.supabase.co');

  for r in select * from public.message_push_pending(k_grace, k_max) loop
    -- The same previews the chat route sends, so a backstopped notification is
    -- indistinguishable from a normal one. More than one missed message in a
    -- conversation collapses to a count rather than N buzzes — the batching
    -- rule `skipPush` encodes, applied on this side too.
    v_preview := case
      when r.missed > 1 then r.missed || ' new messages'
      when r.newest_type = 'image' then '📷 Photo'
      when r.newest_type = 'voice' then '🎙 Voice note'
      when r.newest_type = 'video' then '🎥 Video'
      when r.newest_type = 'file'  then '📎 File'
      when r.newest_type = 'text'  then left(coalesce(r.newest_content, ''), 60)
      else 'New message'
    end;

    insert into public.message_push_state (conversation_id, last_attempted_at, attempts)
    values (r.conversation_id, now(), 1)
    on conflict (conversation_id) do update
      set last_attempted_at = now(),
          attempts = public.message_push_state.attempts + 1;

    perform net.http_post(
      url     := v_url || '/functions/v1/send-push',
      headers := jsonb_build_object('content-type', 'application/json',
                                    'Authorization', 'Bearer ' || v_key),
      body    := jsonb_build_object('conversation_id', r.conversation_id,
                                    'kind', 'message',
                                    'preview', v_preview,
                                    'sender_id', r.sender_id));
    n := n + 1;
  end loop;

  return jsonb_build_object('swept', n, 'capped', n >= k_max);
end;
$function$;

revoke all on function public.message_push_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE SCHEDULE. Every minute: the grace period is 60s, so a message the
--    client failed to announce is announced within about two minutes. At ~12
--    messages a day over 16 conversations the sweep is almost always a single
--    indexed read that returns nothing.
-- ---------------------------------------------------------------------------
-- APPLIED SEPARATELY, AND AFTER THE FUNCTION DEPLOY. Scheduling this while the
-- deployed `send-push` still lacks the service-role branch would post a
-- service-role JWT at a function that answers 401 — and the sweep stamps at
-- DISPATCH, so every one of those messages would be marked attempted and never
-- sent. The order is: apply this file, deploy send-push, verify the server
-- path, then schedule. Recorded here because the wrong order is silent.
--
-- DONE 2026-09-12: send-push deployed, verified, then scheduled as jobid 492.
--
-- AND "VERIFY THE SERVER PATH ANSWERS 200" WAS THE WRONG GATE TO WRITE DOWN.
-- A 200 here means a push delivered to a real person about a real message, so
-- it cannot be obtained without spending somebody's notification on a test.
-- What IS free is the refusal the new branch alone can produce:
--
--   service role, no sender_id          -> 400 sender_id required
--   service role, sender_id, no convo   -> 400 missing fields   (an ADVANCE:
--                                          the uuid check passed)
--   no auth                             -> 401 Unauthorized
--   a function that does not exist      -> 404 NOT_FOUND
--
-- `sender_id required` exists in no earlier deployed build and sits behind
-- `fromServer`; the old build answered 401 to that same call, because a
-- service-role JWT falls into getUser(). So the 400 IS the proof, and the
-- second arm proves the branch validates rather than refusing everything.
-- The SELECT half was then rehearsed against a real conversation inside an
-- aborting DO block — a pg_net request queued in a transaction that rolls back
-- is never sent — which showed swept 1, the body carrying conversation_id and
-- sender_id, and last_attempted_at stamped BEFORE the post.
--
--   select cron.schedule('message-push-backstop', '* * * * *',
--                        'select public.message_push_sweep();');

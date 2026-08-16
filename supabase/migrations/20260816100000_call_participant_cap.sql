-- HOW MANY PEOPLE FIT IN ONE CALL — owner directive, 2026-08-16.
--
-- Free 4, Plus 8. This TRIMS the 2026-08-16 "group calls stay free for
-- everyone" directive rather than replacing it: group calling itself is still
-- on the free plan and nobody loses it, but the size of the room is now a
-- reason to upgrade. Asked and answered explicitly, with the reversal named,
-- before any of this was written.
--
-- WHY A CAP EXISTS AT ALL, AND WHY IT IS NOT A ROUND NUMBER PULLED FROM THE
-- AIR. The call path is a MESH: every participant opens a peer connection to
-- every other participant and sends a separate copy of its own camera to each
-- one. At the client's own bitrate caps (400 kbps video + 64 kbps audio) each
-- extra person costs every phone in the call another 464 kbps up AND down:
--
--     4 people  ->  3 connections per phone, ~1.4 Mbps each way
--     8 people  ->  7 connections per phone, ~3.3 Mbps each way
--
-- Eight is the top of what a phone on good wifi or 5G holds; the header on
-- CallOverlay.tsx said "no participant cap", which on a mesh is not a feature
-- but an unbounded device load and an unbounded TURN relay bill.
--
-- THE CAP IS A COST AND QUALITY GUARD, NOT A SECURITY BOUNDARY. It is read by
-- the client and enforced there, because the thing being protected is the
-- caller's own phone and ONIQ's relay bandwidth — not anybody's data. A
-- client that ignored it would only melt itself.

alter table public.subscription_plans
  add column if not exists max_call_participants integer not null default 4;

comment on column public.subscription_plans.max_call_participants is
  'People in one group call, INCLUDING the caller. Owner directive 2026-08-16: free 4, Plus 8. Mesh topology, so each extra person costs every phone in the call another ~464 kbps in both directions.';

-- A floor rather than a free-for-all: 2 is a 1:1 call, and no plan may go
-- below that or it would sell a phone that cannot ring anyone.
alter table public.subscription_plans
  drop constraint if exists subscription_plans_call_cap_sane;
alter table public.subscription_plans
  add constraint subscription_plans_call_cap_sane
  check (max_call_participants between 2 and 8);

update public.subscription_plans set max_call_participants = 4 where key in ('free', 'topup');
update public.subscription_plans set max_call_participants = 8
 where key in ('plus_monthly', 'plus_25', 'plus_60');

-- How many people fit in THIS user's call.
--
-- Shaped exactly like has_entitlement, including the owner-rides-free rule
-- (2026-08-12): the owner gets the largest cap any plan sells, so a new tier
-- cannot forget to include them. Falls back to the free plan's number rather
-- than to null, so a user with no plan row still gets a working call.
create or replace function public.my_call_cap(_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case
      when is_admin(_user) then (select max(max_call_participants) from subscription_plans where active)
      else (select max_call_participants from subscription_plans where key = my_plan_key(_user))
    end,
    (select max_call_participants from subscription_plans where key = 'free'),
    4
  );
$$;

revoke all on function public.my_call_cap(uuid) from public, anon;
grant execute on function public.my_call_cap(uuid) to authenticated;

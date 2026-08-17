alter table public.subscription_plans
  drop constraint if exists subscription_plans_call_cap_sane;

drop function if exists public.my_call_cap(uuid);

alter table public.subscription_plans
  drop column if exists max_call_participants;
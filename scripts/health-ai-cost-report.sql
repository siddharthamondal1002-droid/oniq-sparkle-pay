-- ONIQ Health AI — cost monitoring, from the receipts (Phase 3, owner
-- directive 2026-09-09: "requests, per operation, per model, input tokens,
-- output tokens, estimated cost; never log raw health content").
--
-- Every gateway call writes ONE receipt (public.health_ai_requests) before
-- the provider runs and completes it after: tokens and cost as the provider
-- reported them, priced from cost.ts PRICE_PER_1M; a refusal or error keeps
-- its receipt with the reason, so a day's spend and a day's failures are
-- read from the same table. No receipt carries a health byte: the manifest
-- is ids, counts and closed names (storableManifest), and this report reads
-- only the numeric and closed columns.
--
-- Run on production through the Lovable database connection (or any
-- read-only role with select on the table). PASS/FAIL is not the shape here;
-- this is a ledger to read.

-- 1. Today and the last 7 days, by task and model: what ran and what it cost.
select
  date_trunc('day', created_at) as day,
  task,
  provider,
  model,
  count(*)                                   as requests,
  count(*) filter (where status = 'ok')      as ok,
  count(*) filter (where status = 'refused') as refused,
  count(*) filter (where status = 'error')   as errors,
  coalesce(sum(input_tokens), 0)             as input_tokens,
  coalesce(sum(output_tokens), 0)            as output_tokens,
  round(coalesce(sum(cost_usd), 0)::numeric, 6) as cost_usd
from public.health_ai_requests
where created_at >= now() - interval '7 days'
group by 1, 2, 3, 4
order by 1 desc, 2, 3, 4;

-- 2. The rolling-24h picture the caps are enforced against: house total and
--    the busiest people (ids only), against the row's caps.
with cfg as (select ai_daily_cap_house, ai_daily_caps from public.health_config where id = true),
last24 as (
  select user_id, task, count(*) as n
  from public.health_ai_requests
  where created_at >= now() - interval '24 hours'
  group by 1, 2
)
select
  'house' as scope, null::uuid as user_id, null::text as task,
  (select sum(n) from last24) as used,
  (select ai_daily_cap_house from cfg) as cap
union all
select 'person', user_id, task, n,
  ((select ai_daily_caps from cfg) ->> task)::int
from last24
order by 1, 4 desc nulls last
limit 50;

-- 3. Why calls were refused or failed, last 7 days — closed codes only.
select refusal_reason, contract_code, count(*) as n
from public.health_ai_requests
where created_at >= now() - interval '7 days' and status <> 'ok'
group by 1, 2
order by 3 desc;

-- 4. A provider failure's closed code is on the ai.refused audit row
--    (detail->>'code'): vertex_http_403_permission_denied, vertex_timeout, …
select created_at, detail->>'task' as task, detail->>'code' as code, count(*) over (partition by detail->>'code') as same_code
from public.health_audit
where action = 'ai.refused' and detail ? 'code' and created_at >= now() - interval '7 days'
order by created_at desc
limit 50;

-- 5. Month to date, one number, against the list price the code carries.
select
  date_trunc('month', now()) as month,
  count(*) as requests,
  coalesce(sum(input_tokens), 0) as input_tokens,
  coalesce(sum(output_tokens), 0) as output_tokens,
  round(coalesce(sum(cost_usd), 0)::numeric, 4) as cost_usd
from public.health_ai_requests
where created_at >= date_trunc('month', now());

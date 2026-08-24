-- SEARCH SPEND TELEMETRY — the numbers the last report could not give.
--
-- Asked on 2026-08-24: what is the average number of searches per query, and
-- what is the prompt-cache hit rate? Neither could be answered, because nothing
-- recorded either one. `search_spend_ledger` now records both per request; this
-- view is the read side. It ADDS NOTHING to the ledger's write path and changes
-- no admission behaviour — it is a projection of rows that already exist.
--
-- Deliberately not a materialized view: the ledger is small (one row per search
-- request) and a stale cost figure is worse than a slow one.

create or replace view public.search_spend_daily_metrics as
select
  l.day,
  l.provider,
  l.model,
  l.search_type,
  count(*)                                                   as requests,
  count(*) filter (where l.state = 'SETTLED')                as settled,
  count(*) filter (where l.state = 'RELEASED')               as released,
  count(*) filter (where l.state = 'RESERVED')               as still_reserved,
  -- The headline: what ONIQ actually spent, with unknowns falling back to the
  -- estimate rather than to zero — the same rule settle_search_spend applies.
  sum(coalesce(l.actual_usd, l.estimated_usd))               as charged_usd,
  count(*) filter (where l.actual_usd is null
                     and l.state = 'SETTLED')                as settled_without_known_cost,
  -- Depth. The number that decides whether max_uses should come down from 11.
  avg(l.search_count) filter (where l.search_count is not null)  as avg_searches,
  max(l.search_count)                                        as max_searches,
  sum(l.search_count)                                        as total_searches,
  -- Cache. Recorded as 1 per request that read from the cache, so the average
  -- IS the hit rate.
  avg(l.cache_hits::numeric) filter (where l.cache_hits is not null) as cache_hit_rate,
  avg(l.input_tokens) filter (where l.input_tokens is not null)      as avg_input_tokens,
  avg(l.output_tokens) filter (where l.output_tokens is not null)    as avg_output_tokens
from public.search_spend_ledger l
group by l.day, l.provider, l.model, l.search_type;

comment on view public.search_spend_daily_metrics is
  'Read-only projection of search_spend_ledger: spend, depth, and cache hit '
  'rate per day/provider/model/search_type. Service role only.';

-- Why each request stopped. Feeds the depth decision: a fleet that mostly stops
-- on SUFFICIENT_EVIDENCE is not depth-bound, one that mostly stops on
-- BUDGET_SEARCHES is.
create or replace view public.search_termination_mix as
select
  l.day,
  l.search_type,
  l.termination_reason,
  count(*) as requests,
  sum(coalesce(l.actual_usd, l.estimated_usd)) as charged_usd
from public.search_spend_ledger l
where l.termination_reason is not null
group by l.day, l.search_type, l.termination_reason;

comment on view public.search_termination_mix is
  'How search requests ended, per day. Service role only.';

-- Same posture as the tables they read: a client must never see the spend
-- ledger, aggregated or not.
revoke all on public.search_spend_daily_metrics from anon, authenticated;
revoke all on public.search_termination_mix      from anon, authenticated;
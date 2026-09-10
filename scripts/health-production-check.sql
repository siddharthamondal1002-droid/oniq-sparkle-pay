-- ONIQ Health — production check. Run READ-ONLY against production (the
-- Lovable database connection, or psql with the service role).
--
-- PASS = zero rows returned. Every row is one violation: what was expected,
-- what was found. It creates nothing and changes nothing.
--
-- The expectations are the two health migrations and the owner's directives
-- of 2026-09-08 (house cap 500 as a ceiling; ai_enabled OFF until the Phase 3
-- gate; the B11 per-task table). src/health/__tests__/productionCheck.test.ts
-- pins every number here to its source, so this file cannot drift from them —
-- change the source, and the test says to change this.
--
-- The audit chain is verified by RECOMPUTING every hash with the exact
-- expression health_verify_audit_chain() uses, because that function requires
-- an admin JWT and a SQL console has none. A row adopted by a later
-- chain.adopt row (migration 20260909130000 — the seq-outside-the-lock race)
-- is content-verified and left out of the linking, as the function does. The
-- recompute is pinned to the function's own text by the same test. The user
-- slot falls back to `actor`
-- when user_id has been nulled by an account's erasure (migration
-- 20260908190000): every writer passes actor = the person's id, so the value
-- the hash committed to is still in the row.
--
-- The deployed edge functions are NOT covered here: pg_net is asynchronous, so
-- a probe is two statements in two transactions. The recipe is at the bottom.

with cfg as (
  select * from public.health_config where id = true
),
expected_config(col, expected) as (values
  ('enabled',                       'true'),
  ('uploads_enabled',               'true'),
  ('ai_enabled',                    'true'),
  ('ai_kill_switch',                'false'),
  ('ai_admin_verification_enabled', 'true'),
  ('provider_sharing_enabled',      'true'),
  ('ai_provider',                   'vertex'),
  ('ai_model',                      'gemini-3.1-flash-lite'),
  ('environment',                   'production'),
  ('ai_daily_cap_house',            '500'),
  ('ai_daily_caps',                 '{"answer_question": 10, "explain_record": 5, "summarize_timeline": 3, "classify_document": 10, "extract_document": 10, "describe_document": 10}')
),
actual_config(col, actual) as (
  select 'enabled', enabled::text from cfg
  union all select 'uploads_enabled', uploads_enabled::text from cfg
  union all select 'ai_enabled', ai_enabled::text from cfg
  union all select 'ai_kill_switch', ai_kill_switch::text from cfg
  union all select 'ai_admin_verification_enabled', ai_admin_verification_enabled::text from cfg
  union all select 'provider_sharing_enabled', provider_sharing_enabled::text from cfg
  union all select 'ai_provider', ai_provider from cfg
  union all select 'ai_model', ai_model from cfg
  union all select 'environment', environment from cfg
  union all select 'ai_daily_cap_house', ai_daily_cap_house::text from cfg
  union all select 'ai_daily_caps', ai_daily_caps::text from cfg
),
expected_tables(name) as (values
  ('health_records'), ('health_documents'), ('health_consents'), ('health_audit'),
  ('health_config'), ('health_retention_policies'), ('health_ai_requests')
),
expected_triggers(name, tbl) as (values
  ('health_config_audit_ai_controls', 'health_config'),
  ('health_config_touch',             'health_config'),
  ('health_audit_chain_before_insert', 'health_audit'),
  ('health_audit_immutable_before_change', 'health_audit'),
  ('health_records_ae_guard',         'health_records'),
  ('health_documents_ae_guard',       'health_documents'),
  ('health_consents_ae_guard',        'health_consents')
),
expected_actions(name) as (values
  ('config.ai_kill'), ('config.ai_caps'), ('config.changed'), ('ai.request'), ('ai.refused')
),
expected_retention(category) as (values
  ('documents'), ('vitals'), ('labs'), ('conditions'), ('medications'), ('allergies'),
  ('immunizations'), ('procedures'), ('encounters'), ('notes'), ('device_metrics'), ('ai_requests')
),
expected_versions(version) as (values
  ('20260908170834'), ('20260908171017'), ('20260908181500'), ('20260908190000'),
  ('20260909100000'), ('20260909130000'), ('20260909150000'), ('20260910120000')
),
audit_fn as (
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'health_config_audit_ai_controls'
),
chain_fn as (
  select pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'health_audit_chain'
),
-- A row a chained chain.adopt row vouches for by record_hash (migration
-- 20260909130000): its content must still recompute, its link is not checked,
-- and it is left out when the rows around it are linked.
adopted as (
  select x as h
  from public.health_audit a, jsonb_array_elements_text(a.detail->'adopts') x
  where a.action = 'chain.adopt'
),
hashed as (
  select r.id, r.seq, r.action, r.detail, r.record_hash, r.prev_hash,
    (r.record_hash in (select h from adopted)) as adopted,
    encode(extensions.digest(
      r.seq::text || '|' || r.id::text || '|' ||
      coalesce(r.user_id::text,
               case when r.actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then r.actor end,
               '') || '|' ||
      r.actor || '|' || r.action || '|' || r.object_type || '|' ||
      coalesce(r.object_id::text,'') || '|' || coalesce(r.purpose,'') || '|' ||
      coalesce(r.consent_id::text,'') || '|' || r.request_id::text || '|' || r.outcome || '|' ||
      r.detail::text || '|' ||
      to_char(r.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      coalesce(r.prev_hash,''), 'sha256'), 'hex') as calc
  from public.health_audit r
),
chain as (
  select h.*, lag(h.record_hash) over (order by h.seq) as expected_prev
  from hashed h
  where not h.adopted
)

-- 1. The config row exists, and every controlled value is what was decided.
select 'MISSING_CONFIG_ROW' as violation, 'one row, id = true' as expected, 'none' as actual
where not exists (select 1 from cfg)
union all
select 'CONFIG_DRIFT ' || e.col, e.expected, coalesce(a.actual, 'null')
from expected_config e left join actual_config a on a.col = e.col
where e.col <> 'ai_daily_caps' and a.actual is distinct from e.expected
union all
select 'CONFIG_DRIFT ai_daily_caps', e.expected, coalesce(a.actual, 'null')
from expected_config e left join actual_config a on a.col = e.col
where e.col = 'ai_daily_caps' and (a.actual is null or a.actual::jsonb <> e.expected::jsonb)

-- 2. Schema: tables, RLS, triggers, the audit vocabulary, the provider lock.
union all
select 'MISSING_TABLE', t.name, 'absent' from expected_tables t
where not exists (select 1 from information_schema.tables i where i.table_schema = 'public' and i.table_name = t.name)
union all
select 'RLS_DISABLED', c.relname, 'relrowsecurity = false'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'health\_%' and not c.relrowsecurity
union all
select 'MISSING_TRIGGER', t.name || ' on ' || t.tbl, 'absent or disabled' from expected_triggers t
where not exists (select 1 from pg_trigger g where g.tgname = t.name and g.tgrelid = ('public.' || t.tbl)::regclass and g.tgenabled = 'O')
union all
select 'MISSING_AUDIT_ACTION', a.name, 'not in health_audit_action_check' from expected_actions a
where not exists (select 1 from pg_constraint k where k.conname = 'health_audit_action_check' and pg_get_constraintdef(k.oid) like '%''' || a.name || '''%')
union all
select 'MISSING_AUDIT_OBJECT_TYPE', 'config', 'not in health_audit_object_type_check'
where not exists (select 1 from pg_constraint k where k.conname = 'health_audit_object_type_check' and pg_get_constraintdef(k.oid) like '%''config''%')
union all
select 'MISSING_AUDIT_ACTION', 'chain.adopt', 'not in health_audit_action_check'
where not exists (select 1 from pg_constraint k where k.conname = 'health_audit_action_check' and pg_get_constraintdef(k.oid) like '%''chain.adopt''%')
union all
select 'MISSING_AUDIT_OBJECT_TYPE', 'chain', 'not in health_audit_object_type_check'
where not exists (select 1 from pg_constraint k where k.conname = 'health_audit_object_type_check' and pg_get_constraintdef(k.oid) like '%''chain''%')
union all
select 'MISSING_INDEX', 'health_audit_seq_key (unique on seq)', 'absent or not unique'
where not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'health_audit' and indexname = 'health_audit_seq_key' and indexdef like 'CREATE UNIQUE INDEX%')
union all
select 'CHAIN_SEQ_NOT_UNDER_LOCK', 'new.seq := coalesce(last_seq, 0) + 1 inside health_audit_chain()', 'the trigger leaves seq to the sequence default'
from chain_fn where def not like '%new.seq := coalesce(last_seq, 0) + 1%'
-- Phase 4 (migration 20260909150000): the caps are reserved in one locked
-- transaction by a function only the service role may call; one request holds
-- at most one receipt; the audit log refuses edits and deletes by trigger.
union all
select 'RESERVE_FN_MISSING', 'health_ai_reserve_request(uuid, uuid, text, text, text, text, uuid, jsonb, integer, integer, timestamptz)', 'absent'
where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'health_ai_reserve_request')
union all
select 'RESERVE_FN_NOT_LOCKED', 'pg_advisory_xact_lock(7700000000000030) before the counts', 'the function counts without the lock'
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'health_ai_reserve_request'
  and pg_get_functiondef(p.oid) not like '%pg_advisory_xact_lock(7700000000000030)%'
union all
select 'RESERVE_FN_CALLABLE_BY_CLIENT', 'no EXECUTE for anon or authenticated', r.rolname
from pg_roles r where r.rolname in ('anon', 'authenticated')
  and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'health_ai_reserve_request')
  and has_function_privilege(r.rolname, 'public.health_ai_reserve_request(uuid, uuid, text, text, text, text, uuid, jsonb, integer, integer, timestamptz)', 'EXECUTE')
union all
select 'MISSING_INDEX', 'health_ai_requests_request_id_key (unique on request_id)', 'absent or not unique'
where not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'health_ai_requests' and indexname = 'health_ai_requests_request_id_key' and indexdef like 'CREATE UNIQUE INDEX%')
union all
select 'AUDIT_IMMUTABLE_FN_CALLABLE_BY_CLIENT', 'no EXECUTE for anon or authenticated', r.rolname
from pg_roles r where r.rolname in ('anon', 'authenticated')
  and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'health_audit_immutable')
  and has_function_privilege(r.rolname, 'public.health_audit_immutable()', 'EXECUTE')
union all
select 'PROVIDER_NOT_LOCKED', 'CHECK ((ai_provider = ANY (ARRAY[''synthetic''::text, ''vertex''::text])))', coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'health_config_ai_provider_check'), 'absent')
where coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'health_config_ai_provider_check'), '') <> 'CHECK ((ai_provider = ANY (ARRAY[''synthetic''::text, ''vertex''::text])))'
union all
select 'RECEIPT_PROVIDER_NOT_LOCKED', 'CHECK ((provider = ANY (ARRAY[''synthetic''::text, ''vertex''::text])))', coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'health_ai_requests_provider_check'), 'absent')
where coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'health_ai_requests_provider_check'), '') <> 'CHECK ((provider = ANY (ARRAY[''synthetic''::text, ''vertex''::text])))'
union all
select 'CONSENT_TERMS_NOT_WIDENED', 'health-ai-terms-v2 names google_vertex', coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'health_consents_terms_recipient_check'), 'absent')
where coalesce((select pg_get_constraintdef(k.oid) from pg_constraint k where k.conname = 'health_consents_terms_recipient_check'), '') not like '%health-ai-terms-v2%google_vertex%'

-- 3. The config audit trigger diffs the whole row and no client can call it.
union all
select 'CONFIG_AUDIT_FN_MISSING', 'health_config_audit_ai_controls()', 'absent'
where not exists (select 1 from audit_fn)
union all
select 'CONFIG_AUDIT_NOT_EVERY_COLUMN', 'jsonb_each(to_jsonb(new) - ''updated_at'')', 'the function names columns instead'
from audit_fn where def not like '%jsonb_each(to_jsonb(new) - ''updated_at'')%'
union all
select 'CONFIG_AUDIT_FN_CALLABLE_BY_CLIENT', 'no EXECUTE for anon or authenticated', r.rolname
from pg_roles r where r.rolname in ('anon', 'authenticated')
  and exists (select 1 from audit_fn)
  and has_function_privilege(r.rolname, 'public.health_config_audit_ai_controls()', 'EXECUTE')
union all
select 'APPEND_AUDIT_CALLABLE_BY_CLIENT', 'no EXECUTE for anon or authenticated', r.rolname
from pg_roles r where r.rolname in ('anon', 'authenticated')
  and has_function_privilege(r.rolname, 'public.health_append_audit(uuid, text, text, text, uuid, text, uuid, uuid, text, jsonb)', 'EXECUTE')
union all
select 'VERIFIER_CALLABLE_BY_ANON', 'EXECUTE for authenticated only (the admin gate is inside)', 'anon'
where has_function_privilege('anon', 'public.health_verify_audit_chain()', 'EXECUTE')

-- 4. Storage: the bucket is private, sized to the documents check, and has no client policy.
union all
select 'BUCKET_MISSING', 'health-documents', 'absent'
where not exists (select 1 from storage.buckets where id = 'health-documents')
union all
select 'BUCKET_PUBLIC', 'public = false', 'public = true'
from storage.buckets where id = 'health-documents' and public
union all
select 'BUCKET_LIMIT_DRIFT', '10485760', coalesce(file_size_limit::text, 'null')
from storage.buckets where id = 'health-documents' and file_size_limit is distinct from 10485760
union all
select 'STORAGE_POLICY_ON_HEALTH_BUCKET', 'none (signed URLs minted by health-api only)', policyname
from pg_policies where schemaname = 'storage'
  and (coalesce(qual, '') like '%health-documents%' or coalesce(with_check, '') like '%health-documents%')

-- 5. Retention rows and the applied migration history.
union all
select 'RETENTION_ROW_MISSING', r.category, 'absent' from expected_retention r
where not exists (select 1 from public.health_retention_policies p where p.category = r.category)
union all
select 'MIGRATION_NOT_IN_HISTORY', v.version, 'absent from supabase_migrations.schema_migrations' from expected_versions v
where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = v.version)

-- 6. The audit chain, recomputed. And a config change nothing audited.
union all
select 'AUDIT_CHAIN_BROKEN', 'seq ' || seq::text, id::text
from chain where calc <> record_hash or prev_hash is distinct from expected_prev
union all
select 'AUDIT_ADOPTED_ROW_ALTERED', 'seq ' || seq::text, id::text
from hashed where adopted and calc <> record_hash
union all
select 'AUDIT_ADOPTION_INVALID', 'seq ' || h.seq::text || ' adopts ' || left(x, 12), h.id::text
from hashed h, jsonb_array_elements_text(h.detail->'adopts') x
where h.action = 'chain.adopt'
  and not exists (select 1 from public.health_audit b where b.record_hash = x and b.seq < h.seq)
union all
select 'CONFIG_CHANGE_UNAUDITED', 'updated_at <= newest config.changed row', 'updated_at ' || updated_at::text
from cfg
where updated_at > coalesce((select max(created_at) from public.health_audit where action = 'config.changed'), updated_at)
-- (cannot see a change made before the first audited one: there is nothing to compare it to)
order by 1, 2;

-- ---------------------------------------------------------------------------
-- The deployed functions, from inside the database (pg_net is installed).
-- Two statements, two transactions — the worker cannot see a request until
-- the statement that queued it commits. Expected with enabled = true:
--   health-api  -> 401 {"ok":false,"reason":"unauthorized",…}   (was 503 health_disabled)
--   health-ai   -> 503 {"ok":false,"reason":"ai_disabled",…}    (was 503 health_disabled)
--   a function that does not exist -> 404 {"code":"NOT_FOUND",…}   (the control)
-- A response at all proves the function is deployed; the reason proves which
-- gate it reached. Neither call carries a credential.
--
-- select net.http_post(url := 'https://bqwttemnnoexadpwifcj.supabase.co/functions/v1/health-api',
--                      body := '{"action":"status"}'::jsonb) as api_req,
--        net.http_post(url := 'https://bqwttemnnoexadpwifcj.supabase.co/functions/v1/health-ai',
--                      body := '{"task":"summarize_timeline"}'::jsonb) as ai_req;
-- -- then, a second later:
-- select id, status_code, content::text from net._http_response
--   where id in (<api_req>, <ai_req>) order by id;

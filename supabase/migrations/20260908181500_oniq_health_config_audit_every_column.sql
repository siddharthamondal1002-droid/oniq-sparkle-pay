-- ONIQ Health — every column of health_config is audited, not five of them.
--
-- 20260908150000_oniq_health_phase2.sql created health_config_audit_ai_controls
-- watching the five AI controls: ai_daily_cap_house, ai_daily_caps,
-- ai_kill_switch, ai_enabled, ai_admin_verification_enabled. The row carries
-- fourteen other switches, and two of them are the ones the go sequence sets
-- FIRST — `enabled`, which makes health-api answer at all, and
-- `uploads_enabled`, which opens document upload. Found 2026-09-08 while
-- applying docs/health/04 §A-2 step 4: `enabled = true` would have been the one
-- change in the sequence with no row in the chain.
--
-- The function is REPLACED under the same name, so the trigger binding and the
-- revoke are unchanged. It now fires when ANY column but updated_at differs,
-- and the detail carries three things: the five keys the Phase 2 rows already
-- use (unchanged, so nothing reading config.changed rows changes), the two
-- master switches, and `changed` — the columns that differed, with their new
-- values — which is what an auditor actually wants to read. health_config holds
-- flags only, never a person's data, so a column set in an audit row is not a
-- leak.
--
-- APPLIED TO PRODUCTION 2026-09-08 18:12Z through the Lovable database
-- connection (query_database), which runs DDL: the function, then the revoke,
-- each as its own statement. Verified by reading pg_get_functiondef back
-- (identical body), the ACL (postgres and service_role only; anon and
-- authenticated cannot EXECUTE), and the trigger still bound and enabled. Then
-- recorded in supabase_migrations.schema_migrations under this version, so a
-- later `supabase db push` treats it as applied — unlike the two hand-named
-- Phase files, whose applied record is Lovable's UUID-named copy of each (see
-- src/health/__tests__/appliedCopies.test.ts). No Lovable message, no credits.
create or replace function public.health_config_audit_ai_controls()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare changed jsonb;
begin
  select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into changed
    from jsonb_each(to_jsonb(new) - 'updated_at') n
    where n.value is distinct from (to_jsonb(old) -> n.key);
  if changed <> '{}'::jsonb then
    perform public.health_append_audit(
      null::uuid, current_user::text, 'config.changed', 'config', null::uuid,
      null::text, null::uuid, gen_random_uuid(), 'ok',
      jsonb_build_object(
        'house', new.ai_daily_cap_house,
        'caps', new.ai_daily_caps,
        'switch', case when new.ai_kill_switch then 'on' else 'off' end,
        'ai_enabled', new.ai_enabled,
        'admin_verification', new.ai_admin_verification_enabled,
        'enabled', new.enabled,
        'uploads', new.uploads_enabled,
        'changed', changed));
  end if;
  return new;
end $$;
revoke all on function public.health_config_audit_ai_controls() from public, anon, authenticated;

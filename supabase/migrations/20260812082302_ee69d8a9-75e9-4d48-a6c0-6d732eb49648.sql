-- ============================================================================
-- SMOKE TEST (2026-08-12) — proof that channel creation works after the
-- conversations_type_check fix. Recorded here because it was executed as a
-- migration; the very next migration deletes what this one creates, so the
-- pair is a no-op on any fresh database.
--
-- The original raised 'owner account not found' when the owner's email was
-- absent, which would ABORT the migration chain on a rebuild or preview
-- branch where that account does not exist. A test must never be able to
-- break a deploy, so a missing account now simply skips the test.
-- ============================================================================
do $$
declare
  me uuid;
  conv uuid;
begin
  select id into me from auth.users where email = 'siddharthamondal1002@gmail.com';
  if me is null then
    raise notice 'owner account absent — skipping channel smoke test';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', me::text, 'role', 'authenticated')::text, true);
  conv := public.create_channel('ONIQ smoke test', 'temporary - deleted by the next migration', true);
  raise notice 'created %', conv;
end $$;

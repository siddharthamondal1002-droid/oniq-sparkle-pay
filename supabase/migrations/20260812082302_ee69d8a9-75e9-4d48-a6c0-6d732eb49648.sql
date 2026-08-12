do $$
declare
  me uuid;
  conv uuid;
begin
  select id into me from auth.users where email = 'siddharthamondal1002@gmail.com';
  if me is null then raise exception 'owner account not found'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', me::text, 'role', 'authenticated')::text, true);
  conv := public.create_channel('ONIQ smoke test', 'temporary - deleted in step 3', true);
  raise notice 'created %', conv;
end $$;
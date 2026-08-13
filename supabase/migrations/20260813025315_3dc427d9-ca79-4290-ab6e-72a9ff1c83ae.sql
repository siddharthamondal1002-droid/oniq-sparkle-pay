do $$
declare
  left_val integer;
begin
  perform public.record_api_use('tts-selftest', 3);
  select public.api_budget_left('tts-selftest', 10) into left_val;
  raise notice 'api_budget_left(tts-selftest, 10) = %', left_val;
end $$;
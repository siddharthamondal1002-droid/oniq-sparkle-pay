do $$
declare
  me uuid;
  result jsonb;
begin
  select id into me from auth.users where email = 'siddharthamondal1002@gmail.com';
  if me is null then
    raise notice 'owner account absent — skipping exercise on fresh replay';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', me::text, 'role', 'authenticated')::text, true);
  result := public.claim_story_seconds(
    120,
    'An Arabian Nights tale in the spirit of Aladdin: a poor, quick-witted young man named Aladdin finds a tarnished old lamp in a hidden desert cave. When he rubs it, a towering jinni of smoke and ember appears and offers to grant his wishes. Aladdin wishes for splendour to win the heart of a clever princess, but a scheming magician tricks the palace and steals the lamp. Aladdin must win it back with his wits rather than wishes. Rich golden light, bustling bazaar, moonlit palace rooftops, a triumphant ending where cleverness beats magic. Give Aladdin spoken dialogue lines in several shots.'
  );
  raise notice 'claim result: %', result;
end $$;

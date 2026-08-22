create table if not exists public._story_free_check (id serial primary key, note text, payload jsonb, at timestamptz default now());
revoke all on public._story_free_check from anon, authenticated;
alter table public._story_free_check enable row level security;

do $$
declare u uuid := '7b52d005-4a03-4c8b-a535-11b57224aa08'; res jsonb; q jsonb; ent boolean;
begin
  -- Exercise block against the owner's live account. A fresh replay (e.g. a
  -- Preview Branch) has no auth.users rows, and claim_story_seconds would then
  -- violate story_allowance's FK. A test must never be able to break a deploy,
  -- so a missing account now simply skips the exercise.
  if not exists (select 1 from auth.users where id = u) then
    raise notice 'owner account absent — skipping exercise on fresh replay';
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', u::text, 'role','authenticated')::text, true);
  ent := public.has_entitlement(u, 'no_watermark');
  q := public.story_quota_status();
  res := public.claim_story_seconds(60, 'A short test story: a paper kite over Kolkata at sunrise.');
  insert into public._story_free_check (note, payload)
  values ('verify', jsonb_build_object('is_admin', public.is_admin(u), 'has_entitlement_no_watermark', ent, 'quota', q, 'claim', res));
end $$;
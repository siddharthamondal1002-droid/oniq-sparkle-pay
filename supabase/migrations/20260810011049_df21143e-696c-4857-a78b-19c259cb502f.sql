create extension if not exists pg_net with schema extensions;
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension pg_cron;
  end if;
end
$$;

create or replace function public.story_dispatch_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  base_url    text;
begin
  if not exists (select 1 from public.story_jobs where status = 'queued') then
    return;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'story_dispatch_service_role_key'
  limit 1;

  if service_key is null then
    select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'email_queue_service_role_key'
    limit 1;
  end if;

  select decrypted_secret into base_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if base_url is null then
    base_url := 'https://bqwttemnnoexadpwifcj.supabase.co';
  end if;

  if service_key is null then
    raise warning 'story_dispatch_tick: no service-role key in vault; queue is not being dispatched';
    return;
  end if;

  perform net.http_post(
    url     := base_url || '/functions/v1/story-dispatch',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.story_dispatch_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('story-dispatch-heartbeat');
exception
  when others then null;
end
$$;

select cron.schedule(
  'story-dispatch-heartbeat',
  '* * * * *',
  $$select public.story_dispatch_tick();$$
);

create index if not exists story_jobs_queued_idx
  on public.story_jobs (created_at)
  where status = 'queued';

create or replace function public.story_sweep_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  service_key text;
  base_url    text;
begin
  if not exists (select 1 from public.story_jobs where has_bytes) then
    return;
  end if;

  select decrypted_secret into service_key
  from vault.decrypted_secrets
  where name = 'story_dispatch_service_role_key'
  limit 1;

  if service_key is null then
    select decrypted_secret into service_key
    from vault.decrypted_secrets
    where name = 'email_queue_service_role_key'
    limit 1;
  end if;

  select decrypted_secret into base_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;

  if base_url is null then
    base_url := 'https://bqwttemnnoexadpwifcj.supabase.co';
  end if;

  if service_key is null then
    raise warning 'story_sweep_tick: no service-role key in vault; user video is NOT being purged';
    return;
  end if;

  perform net.http_post(
    url     := base_url || '/functions/v1/story-sweep',
    headers := jsonb_build_object(
      'content-type',  'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke all on function public.story_sweep_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('story-sweep');
exception
  when others then null;
end
$$;

select cron.schedule(
  'story-sweep',
  '*/15 * * * *',
  $$select public.story_sweep_tick();$$
);
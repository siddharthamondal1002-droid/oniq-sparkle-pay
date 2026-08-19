create table if not exists public.chat_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  r2_key text not null unique,
  upload_id text,
  size_bytes bigint not null,
  mime text,
  file_name text,
  message_id uuid references public.messages (id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '45 days'
);

create index if not exists chat_media_owner_created_idx on public.chat_media (owner_id, created_at desc);
create index if not exists chat_media_expiry_idx on public.chat_media (expires_at) where status = 'ready';
create index if not exists chat_media_message_idx on public.chat_media (message_id);

grant select on public.chat_media to authenticated;
grant all on public.chat_media to service_role;

alter table public.chat_media enable row level security;

drop policy if exists chat_media_select_own on public.chat_media;
create policy chat_media_select_own on public.chat_media
  for select to authenticated
  using (owner_id = auth.uid());

create table if not exists public.media_deletions (
  id uuid primary key default gen_random_uuid(),
  r2_key text not null,
  reason text not null default 'message_deleted',
  queued_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  deleted_at timestamptz
);

create index if not exists media_deletions_pending_idx on public.media_deletions (queued_at) where deleted_at is null;

grant all on public.media_deletions to service_role;
alter table public.media_deletions enable row level security;

create or replace function public.queue_media_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.media_deletions (r2_key, reason)
      select r2_key, 'message_deleted' from public.chat_media where message_id = old.id;
    update public.chat_media set status = 'deleted' where message_id = old.id;
    return old;
  end if;

  if new.is_deleted is true and coalesce(old.is_deleted, false) is false then
    insert into public.media_deletions (r2_key, reason)
      select r2_key, 'message_deleted' from public.chat_media where message_id = new.id;
    update public.chat_media set status = 'deleted' where message_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_media_deletion on public.messages;
create trigger messages_media_deletion
  after update or delete on public.messages
  for each row execute function public.queue_media_deletion();

create or replace function public.media_upload_allowed(_user uuid, _size bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int;
  total bigint;
begin
  select count(*), coalesce(sum(size_bytes), 0) into n, total
  from public.chat_media
  where owner_id = _user
    and created_at > now() - interval '24 hours'
    and status <> 'deleted';

  if n >= 30 then
    return jsonb_build_object('allowed', false, 'reason', 'daily file limit reached — try again tomorrow');
  end if;
  if total + coalesce(_size, 0) > 2147483648 then
    return jsonb_build_object('allowed', false, 'reason', 'daily upload size limit reached — try again tomorrow');
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;

revoke all on function public.media_upload_allowed(uuid, bigint) from public;
grant execute on function public.media_upload_allowed(uuid, bigint) to service_role;
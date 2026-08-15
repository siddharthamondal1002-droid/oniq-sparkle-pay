alter table public.device_tokens
  add column if not exists keys jsonb;

comment on column public.device_tokens.keys is
  'Web Push key material {p256dh, auth} from PushSubscription.toJSON(). Null for FCM rows.';

comment on column public.device_tokens.token is
  'FCM registration token for platform=android; the subscription endpoint URL for platform=web.';

alter table public.device_tokens
  drop constraint if exists device_tokens_web_keys_ck;
alter table public.device_tokens
  add constraint device_tokens_web_keys_ck
  check (
    platform is distinct from 'web'
    or (keys ? 'p256dh' and keys ? 'auth')
  );

create index if not exists device_tokens_user_platform_idx
  on public.device_tokens (user_id, platform);
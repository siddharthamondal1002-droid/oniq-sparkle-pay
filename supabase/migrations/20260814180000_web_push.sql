-- WEB PUSH — the website becomes reachable.
--
-- Owner directive, 2026-08-14, after the call-log audit: 101 accounts, 14 with
-- a push token ever, 4 refreshed inside a week. Six of the nine people called
-- that day had no token at all, so send-push addressed nobody and answered
-- {"sent":0,"failed":0} — a 200 with silence in it. Push was not failing; it
-- was native-only, and most users are on oniqhub.com.
--
-- WHY THE ENDPOINT IS THE PRIMARY KEY, unchanged. device_tokens is keyed on
-- `token`, and a Web Push subscription already has a unique, stable, opaque
-- string of its own: its endpoint URL. Storing it there means the existing
-- upsert-on-conflict, the RLS policies and the stale-row cleanup all keep
-- working untouched for both transports. Only the KEY MATERIAL is new, and it
-- is the one thing FCM has no equivalent of.
--
-- `keys` holds {p256dh, auth} straight from PushSubscription.toJSON(). Both
-- are required to derive the content key (RFC 8291), so a web row missing
-- either is undeliverable — the check below refuses to store one, rather than
-- letting send-push discover it at ring time.

alter table public.device_tokens
  add column if not exists keys jsonb;

comment on column public.device_tokens.keys is
  'Web Push key material {p256dh, auth} from PushSubscription.toJSON(). Null for FCM rows.';

comment on column public.device_tokens.token is
  'FCM registration token for platform=android; the subscription endpoint URL for platform=web.';

-- A web row without both key halves can never be encrypted for. Android rows
-- are unaffected and keep `keys` null.
alter table public.device_tokens
  drop constraint if exists device_tokens_web_keys_ck;
alter table public.device_tokens
  add constraint device_tokens_web_keys_ck
  check (
    platform is distinct from 'web'
    or (keys ? 'p256dh' and keys ? 'auth')
  );

-- send-push now reads per user AND splits by transport; this is the index that
-- read wants.
create index if not exists device_tokens_user_platform_idx
  on public.device_tokens (user_id, platform);

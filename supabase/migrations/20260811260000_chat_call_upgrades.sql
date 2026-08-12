-- ============================================================================
-- CHAT + CALL UPGRADES — stickers land in messages, and call history stops
-- lying about failures.
--
-- OWNER DIRECTIVE (2026-08-11): stickers/filters/video notes in chats, group
-- and conference calling, and a real look at call errors. Two schema facts
-- stand in the way:
--
-- 1. messages.type has no 'sticker' — the constraint allows
--    text/image/voice/video/file/system/call only.
-- 2. call_logs.status CHECK allows only missed/answered/declined/no_answer,
--    but the client writes 'failed' on ICE timeout and TURN unavailability.
--    Postgres has been silently rejecting those updates, which made failed
--    calls indistinguishable from no-answer in history — precisely the
--    errors the owner asked to see.
-- ============================================================================
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages add constraint messages_type_check
  check (type in ('text', 'image', 'voice', 'video', 'file', 'system', 'call', 'sticker'));

alter table public.call_logs drop constraint if exists call_logs_status_check;
alter table public.call_logs add constraint call_logs_status_check
  check (status in ('missed', 'answered', 'declined', 'no_answer', 'failed'));

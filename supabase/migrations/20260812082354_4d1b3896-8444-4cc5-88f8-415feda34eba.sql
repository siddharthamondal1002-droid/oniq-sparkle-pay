-- ============================================================================
-- SMOKE TEST CLEANUP (2026-08-12) — removes the temporary channel created by
-- the previous migration. Deliberately name-scoped and idempotent: it deletes
-- nothing when the test was skipped, so replaying the pair on a fresh
-- database leaves no trace either way.
-- ============================================================================
delete from public.conversation_members where conversation_id in (select id from public.conversations where name = 'ONIQ smoke test');
delete from public.conversations where name = 'ONIQ smoke test';

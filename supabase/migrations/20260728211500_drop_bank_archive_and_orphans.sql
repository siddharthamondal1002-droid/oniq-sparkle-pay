-- Follow-up to 20260728210000_remove_money_storage:
-- * _archive_bank_accounts held real bank references (1 row, exported
--   2026-07-28 before this drop) — removed ahead of PA review. The other
--   _archive_* tables stay (demo data only).
-- * add_bank_account / delete_bank_account survived the CASCADE drop of
--   bank_accounts and would just error if called — remove them.
DROP TABLE IF EXISTS public._archive_bank_accounts;
DROP FUNCTION IF EXISTS public.add_bank_account(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.delete_bank_account(uuid);

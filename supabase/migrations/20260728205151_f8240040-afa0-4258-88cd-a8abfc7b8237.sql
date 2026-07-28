DROP TABLE IF EXISTS public._archive_bank_accounts;
DROP FUNCTION IF EXISTS public.add_bank_account(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.delete_bank_account(uuid);
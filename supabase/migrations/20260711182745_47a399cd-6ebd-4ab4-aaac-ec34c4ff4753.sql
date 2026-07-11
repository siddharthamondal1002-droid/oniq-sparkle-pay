
DROP POLICY IF EXISTS banks_insert_own ON public.bank_accounts;
DROP POLICY IF EXISTS banks_update_own ON public.bank_accounts;
DROP POLICY IF EXISTS banks_delete_own ON public.bank_accounts;

CREATE OR REPLACE FUNCTION public.delete_bank_account(_bank_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); was_primary boolean; next_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT is_primary INTO was_primary FROM bank_accounts WHERE id = _bank_id AND user_id = me;
  IF was_primary IS NULL THEN RAISE EXCEPTION 'account not found'; END IF;
  DELETE FROM bank_accounts WHERE id = _bank_id AND user_id = me;
  IF was_primary THEN
    SELECT id INTO next_id FROM bank_accounts WHERE user_id = me ORDER BY created_at LIMIT 1;
    IF next_id IS NOT NULL THEN
      UPDATE bank_accounts SET is_primary = true WHERE id = next_id;
    END IF;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.delete_bank_account(uuid) TO authenticated;

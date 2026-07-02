-- ============================================================
-- ONIQ LINKED BANK ACCOUNTS
-- Privacy-first: ONLY last-4 digits of account numbers are ever
-- stored. Full numbers are validated in the RPC then discarded.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  holder_name TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  ifsc TEXT NOT NULL,
  account_last4 TEXT NOT NULL CHECK (account_last4 ~ '^[0-9]{4}$'),
  nickname TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON public.bank_accounts(user_id);

GRANT SELECT, DELETE ON public.bank_accounts TO authenticated;
GRANT ALL ON public.bank_accounts TO service_role;

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "banks_select_own" ON public.bank_accounts;
CREATE POLICY "banks_select_own" ON public.bank_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS "banks_delete_own" ON public.bank_accounts;
CREATE POLICY "banks_delete_own" ON public.bank_accounts FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.add_bank_account(
  _holder_name text,
  _bank_name text,
  _ifsc text,
  _account_number text,
  _nickname text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  acct text := regexp_replace(COALESCE(_account_number, ''), '\s', '', 'g');
  code text := UPPER(trim(COALESCE(_ifsc, '')));
  new_id uuid;
  make_primary boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(trim(COALESCE(_holder_name,''))) < 3 THEN RAISE EXCEPTION 'enter the account holder name'; END IF;
  IF length(trim(COALESCE(_bank_name,''))) < 2 THEN RAISE EXCEPTION 'enter the bank name'; END IF;
  IF code !~ '^[A-Z]{4}0[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'invalid IFSC — format is like HDFC0001234'; END IF;
  IF acct !~ '^[0-9]{9,18}$' THEN RAISE EXCEPTION 'account number must be 9–18 digits'; END IF;
  IF (SELECT count(*) FROM bank_accounts WHERE user_id = me) >= 5 THEN
    RAISE EXCEPTION 'maximum 5 linked accounts';
  END IF;
  IF EXISTS (SELECT 1 FROM bank_accounts
             WHERE user_id = me AND ifsc = code AND account_last4 = right(acct, 4)) THEN
    RAISE EXCEPTION 'that account is already linked';
  END IF;

  make_primary := NOT EXISTS (SELECT 1 FROM bank_accounts WHERE user_id = me);

  INSERT INTO bank_accounts (user_id, holder_name, bank_name, ifsc, account_last4, nickname, is_primary)
  VALUES (me, trim(_holder_name), trim(_bank_name), code, right(acct, 4),
          NULLIF(trim(COALESCE(_nickname,'')), ''), make_primary)
  RETURNING id INTO new_id;

  RETURN new_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_bank_account(text, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_primary_bank(_bank_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM bank_accounts WHERE id = _bank_id AND user_id = me) THEN
    RAISE EXCEPTION 'account not found';
  END IF;
  UPDATE bank_accounts SET is_primary = (id = _bank_id) WHERE user_id = me;
END; $$;
GRANT EXECUTE ON FUNCTION public.set_primary_bank(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.withdraw_to_bank(_bank_id uuid, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  bank record;
  bal numeric;
  txn_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 10000 THEN
    RAISE EXCEPTION 'amount must be between 0 and 10,000';
  END IF;

  SELECT * INTO bank FROM bank_accounts WHERE id = _bank_id AND user_id = me;
  IF bank IS NULL THEN RAISE EXCEPTION 'bank account not found'; END IF;

  SELECT fiat_balance INTO bal FROM wallets WHERE user_id = me FOR UPDATE;
  IF bal IS NULL OR bal < _amount THEN RAISE EXCEPTION 'insufficient funds'; END IF;

  UPDATE wallets SET fiat_balance = fiat_balance - _amount, updated_at = now() WHERE user_id = me;

  INSERT INTO transactions (sender_id, amount, currency, type, status, note, metadata)
  VALUES (me, _amount, 'USD', 'withdrawal', 'completed',
          'Withdrawal to ' || bank.bank_name || ' ••' || bank.account_last4,
          jsonb_build_object('bank_id', bank.id, 'demo', true))
  RETURNING id INTO txn_id;

  RETURN txn_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.withdraw_to_bank(uuid, numeric) TO authenticated;

-- ============================================================
-- ONIQ PAYMENTS FEATURE PACK — PhonePe/GPay/Paytm-style features
-- 1) profiles.upi_vpa  → powers "My QR" (receive real money)
-- 2) payment_requests  → PhonePe-style "Request money" (demo wallet)
-- ============================================================

-- ---------- 1) Store the user's own UPI ID ----------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS upi_vpa TEXT;

-- ---------- 2) Money requests ----------
CREATE TABLE IF NOT EXISTS public.payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0 AND amount <= 10000),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','declined')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_payreq_payer ON public.payment_requests(payer_id, status);

GRANT SELECT ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payreq_parties_select" ON public.payment_requests;
CREATE POLICY "payreq_parties_select" ON public.payment_requests FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR payer_id = auth.uid());

-- ---------- RPC: create a request ----------
CREATE OR REPLACE FUNCTION public.create_payment_request(
  _from_username text, _amount numeric, _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  payer uuid;
  req_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 10000 THEN
    RAISE EXCEPTION 'amount must be between 0 and 10,000';
  END IF;
  SELECT id INTO payer FROM profiles WHERE username = LOWER(_from_username);
  IF payer IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF payer = me THEN RAISE EXCEPTION 'cannot request from yourself'; END IF;
  IF (SELECT count(*) FROM payment_requests
      WHERE requester_id = me AND payer_id = payer AND status = 'pending') >= 10 THEN
    RAISE EXCEPTION 'too many pending requests to this user';
  END IF;
  INSERT INTO payment_requests (requester_id, payer_id, amount, note)
  VALUES (me, payer, _amount, NULLIF(trim(_note), ''))
  RETURNING id INTO req_id;
  RETURN req_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_payment_request(text, numeric, text) TO authenticated;

-- ---------- RPC: pay or decline a request (atomic transfer on accept) ----------
CREATE OR REPLACE FUNCTION public.respond_payment_request(_request_id uuid, _accept boolean)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  req record;
  first_lock uuid;
  second_lock uuid;
  bal numeric;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO req FROM payment_requests
  WHERE id = _request_id AND payer_id = me AND status = 'pending'
  FOR UPDATE;
  IF req IS NULL THEN RAISE EXCEPTION 'request not found or already handled'; END IF;

  IF NOT _accept THEN
    UPDATE payment_requests SET status = 'declined', resolved_at = now() WHERE id = _request_id;
    RETURN 'declined';
  END IF;

  IF me < req.requester_id THEN first_lock := me; second_lock := req.requester_id;
  ELSE first_lock := req.requester_id; second_lock := me; END IF;
  PERFORM 1 FROM wallets WHERE user_id = first_lock FOR UPDATE;
  PERFORM 1 FROM wallets WHERE user_id = second_lock FOR UPDATE;

  SELECT fiat_balance INTO bal FROM wallets WHERE user_id = me;
  IF bal IS NULL OR bal < req.amount THEN RAISE EXCEPTION 'insufficient funds — top up your wallet'; END IF;

  UPDATE wallets SET fiat_balance = fiat_balance - req.amount, updated_at = now() WHERE user_id = me;
  UPDATE wallets SET fiat_balance = fiat_balance + req.amount, updated_at = now() WHERE user_id = req.requester_id;
  INSERT INTO transactions (sender_id, recipient_id, amount, currency, type, status, note)
  VALUES (me, req.requester_id, req.amount, 'USD', 'transfer', 'completed',
          COALESCE('Request: ' || req.note, 'Payment request'));

  UPDATE payment_requests SET status = 'paid', resolved_at = now() WHERE id = _request_id;
  RETURN 'paid';
END; $$;
GRANT EXECUTE ON FUNCTION public.respond_payment_request(uuid, boolean) TO authenticated;

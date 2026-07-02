CREATE TABLE IF NOT EXISTS public.red_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0 AND amount <= 10000),
  greeting TEXT NOT NULL DEFAULT 'Good fortune! 🧧',
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','reclaimed')) DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_redpacket_recipient ON public.red_packets(recipient_id, status);

GRANT SELECT ON public.red_packets TO authenticated;
GRANT ALL ON public.red_packets TO service_role;

ALTER TABLE public.red_packets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "redpacket_parties_select" ON public.red_packets;
CREATE POLICY "redpacket_parties_select" ON public.red_packets FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

CREATE OR REPLACE FUNCTION public.send_red_packet(
  _to_username text, _amount numeric, _greeting text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  recip uuid;
  bal numeric;
  packet_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount > 10000 THEN
    RAISE EXCEPTION 'amount must be between 0 and 10,000';
  END IF;
  SELECT id INTO recip FROM profiles WHERE username = LOWER(_to_username);
  IF recip IS NULL THEN RAISE EXCEPTION 'user not found'; END IF;
  IF recip = me THEN RAISE EXCEPTION 'cannot send a packet to yourself'; END IF;
  SELECT fiat_balance INTO bal FROM wallets WHERE user_id = me FOR UPDATE;
  IF bal IS NULL OR bal < _amount THEN RAISE EXCEPTION 'insufficient funds — top up first'; END IF;
  UPDATE wallets SET fiat_balance = fiat_balance - _amount, updated_at = now() WHERE user_id = me;
  INSERT INTO red_packets (sender_id, recipient_id, amount, greeting)
  VALUES (me, recip, _amount, COALESCE(NULLIF(trim(_greeting), ''), 'Good fortune! 🧧'))
  RETURNING id INTO packet_id;
  INSERT INTO transactions (sender_id, recipient_id, amount, currency, type, status, note, metadata)
  VALUES (me, recip, _amount, 'USD', 'red_packet_send', 'completed', 'Red packet 🧧',
          jsonb_build_object('packet_id', packet_id));
  RETURN packet_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.send_red_packet(text, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.open_red_packet(_packet_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  packet record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO packet FROM red_packets
  WHERE id = _packet_id AND recipient_id = me AND status = 'pending'
  FOR UPDATE;
  IF packet IS NULL THEN RAISE EXCEPTION 'packet not found or already opened'; END IF;
  UPDATE wallets SET fiat_balance = fiat_balance + packet.amount, updated_at = now()
  WHERE user_id = me;
  INSERT INTO transactions (sender_id, recipient_id, amount, currency, type, status, note, metadata)
  VALUES (packet.sender_id, me, packet.amount, 'USD', 'red_packet_claim', 'completed',
          'Opened a red packet 🧧', jsonb_build_object('packet_id', packet.id));
  UPDATE red_packets SET status = 'claimed', resolved_at = now() WHERE id = _packet_id;
  RETURN packet.amount;
END; $$;

GRANT EXECUTE ON FUNCTION public.open_red_packet(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reclaim_red_packet(_packet_id uuid)
RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  packet record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO packet FROM red_packets
  WHERE id = _packet_id AND sender_id = me AND status = 'pending'
  FOR UPDATE;
  IF packet IS NULL THEN RAISE EXCEPTION 'packet not found or already resolved'; END IF;
  IF packet.created_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'packets can be reclaimed 24h after sending';
  END IF;
  UPDATE wallets SET fiat_balance = fiat_balance + packet.amount, updated_at = now()
  WHERE user_id = me;
  INSERT INTO transactions (recipient_id, amount, currency, type, status, note, metadata)
  VALUES (me, packet.amount, 'USD', 'refund', 'completed', 'Red packet reclaimed',
          jsonb_build_object('packet_id', packet.id));
  UPDATE red_packets SET status = 'reclaimed', resolved_at = now() WHERE id = _packet_id;
  RETURN packet.amount;
END; $$;

GRANT EXECUTE ON FUNCTION public.reclaim_red_packet(uuid) TO authenticated;
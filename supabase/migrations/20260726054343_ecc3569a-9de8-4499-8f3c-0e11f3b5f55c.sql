-- inDrive-style price negotiation on bookings: customer names a price,
-- partner accepts or counters, either side re-offers until one accepts.
-- ONIQ takes no cut — agreed_price is the direct customer↔partner contract.

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS offered_price numeric CHECK (offered_price IS NULL OR offered_price > 0),
  ADD COLUMN IF NOT EXISTS counter_price numeric CHECK (counter_price IS NULL OR counter_price > 0),
  ADD COLUMN IF NOT EXISTS agreed_price numeric;

ALTER TABLE public.service_bookings
  DROP CONSTRAINT IF EXISTS service_bookings_status_check;
ALTER TABLE public.service_bookings
  ADD CONSTRAINT service_bookings_status_check
  CHECK (status IN ('requested','countered','accepted','in_progress','declined','cancelled','done'));

-- ---------- book with a price offer ----------
DROP FUNCTION IF EXISTS public.book_service(uuid, text, date, text, text, text);
CREATE OR REPLACE FUNCTION public.book_service(
  _application_id uuid,
  _category text DEFAULT NULL,
  _scheduled_date date DEFAULT NULL,
  _time_slot text DEFAULT NULL,
  _address text DEFAULT NULL,
  _note text DEFAULT NULL,
  _offered_price numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  pa record;
  cnt int;
  bid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _offered_price IS NULL OR _offered_price < 10 THEN
    RAISE EXCEPTION 'offer a price (at least Rs 10)';
  END IF;
  SELECT * INTO pa FROM partner_applications WHERE id = _application_id;
  IF pa.id IS NULL THEN RAISE EXCEPTION 'partner not found'; END IF;
  IF pa.user_id = me THEN RAISE EXCEPTION 'you cannot book yourself'; END IF;
  IF pa.verification_status NOT IN ('submitted','verified') THEN
    RAISE EXCEPTION 'partner is not verified yet';
  END IF;
  IF _category IS NOT NULL AND NOT (_category = ANY(pa.skills)) THEN
    RAISE EXCEPTION 'partner does not offer this service';
  END IF;
  IF _scheduled_date IS NOT NULL AND _scheduled_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'pick today or a future date';
  END IF;
  SELECT count(*)::int INTO cnt FROM partner_applications p2
    WHERE lower(trim(COALESCE(p2.region, p2.city))) = lower(trim(COALESCE(pa.region, pa.city)))
      AND p2.verification_status IN ('submitted','verified');
  IF cnt < 20 THEN
    RAISE EXCEPTION 'ONIQ services are not live in this region yet (% of 20 partners)', cnt;
  END IF;
  INSERT INTO service_bookings
    (application_id, customer_id, region, category, scheduled_date, time_slot, address, note, offered_price)
  VALUES
    (_application_id, me, lower(trim(COALESCE(pa.region, pa.city))),
     _category, _scheduled_date, NULLIF(trim(_time_slot), ''),
     NULLIF(trim(_address), ''), NULLIF(trim(_note), ''), round(_offered_price))
  RETURNING id INTO bid;
  RETURN jsonb_build_object('booking_id', bid, 'provider_user_id', pa.user_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.book_service(uuid, text, date, text, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_service(uuid, text, date, text, text, text, numeric) TO authenticated;

-- ---------- negotiation: offer / counter / accept ----------
-- Role-aware re-offer: partner counters, customer re-offers.
CREATE OR REPLACE FUNCTION public.offer_booking_price(_booking_id uuid, _price numeric)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); b record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price IS NULL OR _price < 10 THEN RAISE EXCEPTION 'price must be at least Rs 10'; END IF;
  SELECT b2.*, pa.user_id AS provider_user_id INTO b
  FROM service_bookings b2 JOIN partner_applications pa ON pa.id = b2.application_id
  WHERE b2.id = _booking_id FOR UPDATE OF b2;
  IF b.id IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF b.status NOT IN ('requested','countered') THEN RAISE EXCEPTION 'price is already settled'; END IF;
  IF me = b.provider_user_id THEN
    UPDATE service_bookings SET counter_price = round(_price), status = 'countered' WHERE id = _booking_id;
  ELSIF me = b.customer_id THEN
    UPDATE service_bookings SET offered_price = round(_price), counter_price = NULL, status = 'requested' WHERE id = _booking_id;
  ELSE
    RAISE EXCEPTION 'not your booking';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.offer_booking_price(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offer_booking_price(uuid, numeric) TO authenticated;

-- Role-aware accept: partner accepts the customer's offer, or the customer
-- accepts the partner's counter. Locks agreed_price and confirms the job.
CREATE OR REPLACE FUNCTION public.accept_booking_price(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); b record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT b2.*, pa.user_id AS provider_user_id INTO b
  FROM service_bookings b2 JOIN partner_applications pa ON pa.id = b2.application_id
  WHERE b2.id = _booking_id FOR UPDATE OF b2;
  IF b.id IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF me = b.provider_user_id AND b.status = 'requested' THEN
    UPDATE service_bookings SET agreed_price = offered_price, status = 'accepted' WHERE id = _booking_id;
  ELSIF me = b.customer_id AND b.status = 'countered' THEN
    UPDATE service_bookings SET agreed_price = counter_price, status = 'accepted' WHERE id = _booking_id;
  ELSE
    RAISE EXCEPTION 'nothing to accept right now';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.accept_booking_price(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_booking_price(uuid) TO authenticated;

-- ---------- lifecycle updated for the countered state ----------
CREATE OR REPLACE FUNCTION public.respond_booking(_booking_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); b record; is_provider boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _status NOT IN ('accepted','in_progress','declined','cancelled','done') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  SELECT b2.*, pa.user_id AS provider_user_id INTO b
  FROM service_bookings b2 JOIN partner_applications pa ON pa.id = b2.application_id
  WHERE b2.id = _booking_id FOR UPDATE OF b2;
  IF b.id IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  is_provider := (b.provider_user_id = me);
  IF _status = 'cancelled' THEN
    IF b.customer_id <> me THEN RAISE EXCEPTION 'only the customer can cancel'; END IF;
    IF b.status NOT IN ('requested','countered','accepted') THEN RAISE EXCEPTION 'too late to cancel'; END IF;
  ELSIF NOT is_provider THEN
    RAISE EXCEPTION 'only the partner can update this booking';
  ELSIF _status = 'accepted' THEN
    IF b.status <> 'requested' THEN RAISE EXCEPTION 'only new requests can be accepted'; END IF;
    -- Accepting the job = accepting the customer's price.
    UPDATE service_bookings SET agreed_price = offered_price WHERE id = _booking_id;
  ELSIF _status = 'declined' AND b.status NOT IN ('requested','countered') THEN
    RAISE EXCEPTION 'job already confirmed';
  ELSIF _status = 'in_progress' AND b.status <> 'accepted' THEN
    RAISE EXCEPTION 'accept the booking first';
  ELSIF _status = 'done' AND b.status NOT IN ('accepted','in_progress') THEN
    RAISE EXCEPTION 'booking is not active';
  END IF;
  UPDATE service_bookings SET status = _status WHERE id = _booking_id;
END;
$$;

-- ---------- listings include prices ----------
DROP FUNCTION IF EXISTS public.my_partner_bookings();
CREATE OR REPLACE FUNCTION public.my_partner_bookings()
RETURNS TABLE (
  id uuid, customer_id uuid, customer_name text, category text,
  scheduled_date date, time_slot text, address text, note text, status text,
  offered_price numeric, counter_price numeric, agreed_price numeric,
  rating int, review text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.customer_id,
         COALESCE(pr.display_name, pr.username, 'ONIQ user') AS customer_name,
         b.category, b.scheduled_date, b.time_slot, b.address, b.note, b.status,
         b.offered_price, b.counter_price, b.agreed_price,
         b.rating, b.review, b.created_at
  FROM service_bookings b
  JOIN partner_applications pa ON pa.id = b.application_id
  LEFT JOIN profiles pr ON pr.id = b.customer_id
  WHERE pa.user_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.my_partner_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_partner_bookings() TO authenticated;

DROP FUNCTION IF EXISTS public.my_service_bookings();
CREATE OR REPLACE FUNCTION public.my_service_bookings()
RETURNS TABLE (
  id uuid, provider_user_id uuid, provider_name text, category text,
  scheduled_date date, time_slot text, note text, status text,
  offered_price numeric, counter_price numeric, agreed_price numeric,
  rating int, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, pa.user_id AS provider_user_id, pa.full_name AS provider_name,
         b.category, b.scheduled_date, b.time_slot, b.note, b.status,
         b.offered_price, b.counter_price, b.agreed_price,
         b.rating, b.created_at
  FROM service_bookings b
  JOIN partner_applications pa ON pa.id = b.application_id
  WHERE b.customer_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.my_service_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_bookings() TO authenticated;
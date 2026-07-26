-- Urban-Company-style booking infrastructure on top of service_bookings:
-- structured bookings (service category, scheduled date, time slot, address),
-- a job lifecycle (requested → accepted → in_progress → done), and
-- post-completion ratings that surface on provider cards.

ALTER TABLE public.service_bookings
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS time_slot text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS rating int CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS review text,
  ADD COLUMN IF NOT EXISTS rated_at timestamptz;

ALTER TABLE public.service_bookings
  DROP CONSTRAINT IF EXISTS service_bookings_status_check;
ALTER TABLE public.service_bookings
  ADD CONSTRAINT service_bookings_status_check
  CHECK (status IN ('requested','accepted','in_progress','declined','cancelled','done'));

-- ---------- book: structured request ----------
DROP FUNCTION IF EXISTS public.book_service(uuid, text);
CREATE OR REPLACE FUNCTION public.book_service(
  _application_id uuid,
  _category text DEFAULT NULL,
  _scheduled_date date DEFAULT NULL,
  _time_slot text DEFAULT NULL,
  _address text DEFAULT NULL,
  _note text DEFAULT NULL
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
    (application_id, customer_id, region, category, scheduled_date, time_slot, address, note)
  VALUES
    (_application_id, me, lower(trim(COALESCE(pa.region, pa.city))),
     _category, _scheduled_date, NULLIF(trim(_time_slot), ''),
     NULLIF(trim(_address), ''), NULLIF(trim(_note), ''))
  RETURNING id INTO bid;
  RETURN jsonb_build_object('booking_id', bid, 'provider_user_id', pa.user_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.book_service(uuid, text, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_service(uuid, text, date, text, text, text) TO authenticated;

-- ---------- lifecycle: requested → accepted → in_progress → done ----------
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
    IF b.status NOT IN ('requested','accepted') THEN RAISE EXCEPTION 'too late to cancel'; END IF;
  ELSIF NOT is_provider THEN
    RAISE EXCEPTION 'only the partner can update this booking';
  ELSIF _status = 'accepted' AND b.status <> 'requested' THEN
    RAISE EXCEPTION 'only new requests can be accepted';
  ELSIF _status = 'in_progress' AND b.status <> 'accepted' THEN
    RAISE EXCEPTION 'accept the booking first';
  ELSIF _status = 'done' AND b.status NOT IN ('accepted','in_progress') THEN
    RAISE EXCEPTION 'booking is not active';
  END IF;
  UPDATE service_bookings SET status = _status WHERE id = _booking_id;
END;
$$;

-- ---------- rating (customer, after completion, once) ----------
CREATE OR REPLACE FUNCTION public.rate_booking(_booking_id uuid, _rating int, _review text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); b record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _rating IS NULL OR _rating < 1 OR _rating > 5 THEN RAISE EXCEPTION 'rating must be 1-5'; END IF;
  SELECT * INTO b FROM service_bookings WHERE id = _booking_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  IF b.customer_id <> me THEN RAISE EXCEPTION 'only the customer can rate'; END IF;
  IF b.status <> 'done' THEN RAISE EXCEPTION 'rate after the job is done'; END IF;
  IF b.rating IS NOT NULL THEN RAISE EXCEPTION 'already rated'; END IF;
  UPDATE service_bookings
  SET rating = _rating, review = NULLIF(trim(_review), ''), rated_at = now()
  WHERE id = _booking_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rate_booking(uuid, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_booking(uuid, int, text) TO authenticated;

-- ---------- provider cards: ratings + jobs done ----------
DROP FUNCTION IF EXISTS public.list_region_providers(text);
CREATE OR REPLACE FUNCTION public.list_region_providers(_region text)
RETURNS TABLE (
  id uuid,
  full_name text,
  skills text[],
  area text,
  village text,
  experience_years int,
  avg_rating numeric,
  jobs_done int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pa.id, pa.full_name, pa.skills, pa.area, pa.village, pa.experience_years,
         round((SELECT avg(b.rating) FROM service_bookings b
                WHERE b.application_id = pa.id AND b.rating IS NOT NULL), 1) AS avg_rating,
         (SELECT count(*)::int FROM service_bookings b
          WHERE b.application_id = pa.id AND b.status = 'done') AS jobs_done
  FROM partner_applications pa
  WHERE lower(trim(COALESCE(pa.region, pa.city))) = lower(trim(_region))
    AND pa.verification_status IN ('submitted','verified')
    AND (
      SELECT count(*) FROM partner_applications p2
      WHERE lower(trim(COALESCE(p2.region, p2.city))) = lower(trim(_region))
        AND p2.verification_status IN ('submitted','verified')
    ) >= 20
  ORDER BY avg_rating DESC NULLS LAST, jobs_done DESC, pa.experience_years DESC, pa.created_at ASC;
$$;
REVOKE EXECUTE ON FUNCTION public.list_region_providers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_region_providers(text) TO authenticated;

-- ---------- booking lists with the new fields ----------
DROP FUNCTION IF EXISTS public.my_partner_bookings();
CREATE OR REPLACE FUNCTION public.my_partner_bookings()
RETURNS TABLE (
  id uuid,
  customer_id uuid,
  customer_name text,
  category text,
  scheduled_date date,
  time_slot text,
  address text,
  note text,
  status text,
  rating int,
  review text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.customer_id,
         COALESCE(pr.display_name, pr.username, 'ONIQ user') AS customer_name,
         b.category, b.scheduled_date, b.time_slot, b.address,
         b.note, b.status, b.rating, b.review, b.created_at
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
  id uuid,
  provider_user_id uuid,
  provider_name text,
  category text,
  scheduled_date date,
  time_slot text,
  note text,
  status text,
  rating int,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, pa.user_id AS provider_user_id, pa.full_name AS provider_name,
         b.category, b.scheduled_date, b.time_slot,
         b.note, b.status, b.rating, b.created_at
  FROM service_bookings b
  JOIN partner_applications pa ON pa.id = b.application_id
  WHERE b.customer_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.my_service_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_bookings() TO authenticated;
ALTER TABLE public.partner_applications
  ADD COLUMN IF NOT EXISTS village text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS aadhaar_path text,
  ADD COLUMN IF NOT EXISTS pan_path text,
  ADD COLUMN IF NOT EXISTS extra_doc_path text,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.partner_applications
  DROP CONSTRAINT IF EXISTS partner_applications_verification_status_check;
ALTER TABLE public.partner_applications
  ADD CONSTRAINT partner_applications_verification_status_check
  CHECK (verification_status IN ('pending','submitted','verified','rejected'));

UPDATE public.partner_applications
  SET region = lower(trim(city))
  WHERE region IS NULL;

GRANT UPDATE ON public.partner_applications TO authenticated;
DROP POLICY IF EXISTS "update own partner application" ON public.partner_applications;
CREATE POLICY "update own partner application" ON public.partner_applications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "verification docs upload own" ON storage.objects;
CREATE POLICY "verification docs upload own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "verification docs read own" ON storage.objects;
CREATE POLICY "verification docs read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "verification docs replace own" ON storage.objects;
CREATE POLICY "verification docs replace own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE OR REPLACE FUNCTION public.get_region_status(_region text)
RETURNS TABLE (provider_count int, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    count(*)::int AS provider_count,
    count(*) >= 20 AS enabled
  FROM partner_applications pa
  WHERE lower(trim(COALESCE(pa.region, pa.city))) = lower(trim(_region))
    AND pa.verification_status IN ('submitted','verified');
$$;
REVOKE EXECUTE ON FUNCTION public.get_region_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_region_status(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_region_providers(_region text)
RETURNS TABLE (
  id uuid,
  full_name text,
  skills text[],
  area text,
  village text,
  experience_years int
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pa.id, pa.full_name, pa.skills, pa.area, pa.village, pa.experience_years
  FROM partner_applications pa
  WHERE lower(trim(COALESCE(pa.region, pa.city))) = lower(trim(_region))
    AND pa.verification_status IN ('submitted','verified')
    AND (
      SELECT count(*) FROM partner_applications p2
      WHERE lower(trim(COALESCE(p2.region, p2.city))) = lower(trim(_region))
        AND p2.verification_status IN ('submitted','verified')
    ) >= 20
  ORDER BY pa.experience_years DESC, pa.created_at ASC;
$$;
REVOKE EXECUTE ON FUNCTION public.list_region_providers(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_region_providers(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.service_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  region text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','declined','cancelled','done')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.service_bookings TO authenticated;
GRANT ALL ON public.service_bookings TO service_role;
ALTER TABLE public.service_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings customer select" ON public.service_bookings;
CREATE POLICY "bookings customer select" ON public.service_bookings
  FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM partner_applications pa
      WHERE pa.id = application_id AND pa.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.book_service(_application_id uuid, _note text DEFAULT NULL)
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
  SELECT count(*)::int INTO cnt FROM partner_applications p2
    WHERE lower(trim(COALESCE(p2.region, p2.city))) = lower(trim(COALESCE(pa.region, pa.city)))
      AND p2.verification_status IN ('submitted','verified');
  IF cnt < 20 THEN
    RAISE EXCEPTION 'ONIQ services are not live in this region yet (% of 20 partners)', cnt;
  END IF;
  INSERT INTO service_bookings (application_id, customer_id, region, note)
  VALUES (_application_id, me, lower(trim(COALESCE(pa.region, pa.city))), NULLIF(trim(_note), ''))
  RETURNING id INTO bid;
  RETURN jsonb_build_object('booking_id', bid, 'provider_user_id', pa.user_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.book_service(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_service(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_partner_bookings()
RETURNS TABLE (
  id uuid,
  customer_id uuid,
  customer_name text,
  note text,
  status text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.customer_id,
         COALESCE(pr.display_name, pr.username, 'ONIQ user') AS customer_name,
         b.note, b.status, b.created_at
  FROM service_bookings b
  JOIN partner_applications pa ON pa.id = b.application_id
  LEFT JOIN profiles pr ON pr.id = b.customer_id
  WHERE pa.user_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.my_partner_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_partner_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_service_bookings()
RETURNS TABLE (
  id uuid,
  provider_user_id uuid,
  provider_name text,
  note text,
  status text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, pa.user_id AS provider_user_id, pa.full_name AS provider_name,
         b.note, b.status, b.created_at
  FROM service_bookings b
  JOIN partner_applications pa ON pa.id = b.application_id
  WHERE b.customer_id = auth.uid()
  ORDER BY b.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.my_service_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_service_bookings() TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_booking(_booking_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); b record; is_provider boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _status NOT IN ('accepted','declined','cancelled','done') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;
  SELECT b2.*, pa.user_id AS provider_user_id INTO b
  FROM service_bookings b2 JOIN partner_applications pa ON pa.id = b2.application_id
  WHERE b2.id = _booking_id FOR UPDATE OF b2;
  IF b.id IS NULL THEN RAISE EXCEPTION 'booking not found'; END IF;
  is_provider := (b.provider_user_id = me);
  IF _status = 'cancelled' THEN
    IF b.customer_id <> me THEN RAISE EXCEPTION 'only the customer can cancel'; END IF;
  ELSIF NOT is_provider THEN
    RAISE EXCEPTION 'only the partner can update this booking';
  END IF;
  UPDATE service_bookings SET status = _status WHERE id = _booking_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.respond_booking(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_booking(uuid, text) TO authenticated;
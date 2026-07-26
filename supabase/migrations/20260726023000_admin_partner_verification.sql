-- Admin review of partner KYC documents: list applications with doc paths,
-- approve/reject, and let admins read the private verification-docs bucket
-- so they can view the uploaded Aadhaar/PAN. (DigiLocker/API-based checks can
-- later set the same verification_status field.)

CREATE OR REPLACE FUNCTION public.admin_list_partner_verifications()
RETURNS TABLE (
  id uuid,
  user_id uuid,
  full_name text,
  phone text,
  city text,
  village text,
  region text,
  skills text[],
  verification_status text,
  aadhaar_path text,
  pan_path text,
  extra_doc_path text,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pa.id, pa.user_id, pa.full_name, pa.phone, pa.city, pa.village,
         pa.region, pa.skills, pa.verification_status,
         pa.aadhaar_path, pa.pan_path, pa.extra_doc_path, pa.created_at
  FROM partner_applications pa
  WHERE public.is_admin(auth.uid())
  ORDER BY
    CASE pa.verification_status WHEN 'submitted' THEN 0 WHEN 'pending' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
    pa.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_list_partner_verifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_partner_verifications() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_partner_verification(_application_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.is_admin(me) THEN RAISE EXCEPTION 'admins only'; END IF;
  IF _status NOT IN ('verified','rejected','pending') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE partner_applications SET verification_status = _status WHERE id = _application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application not found'; END IF;
  INSERT INTO admin_actions (admin_id, action, target_type, target_id, note)
  VALUES (me, 'partner_' || _status, 'partner_application', _application_id::text, 'KYC review');
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_set_partner_verification(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_partner_verification(uuid, text) TO authenticated;

-- Admins may read verification documents (owners already could).
DROP POLICY IF EXISTS "verification docs read own" ON storage.objects;
CREATE POLICY "verification docs read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'verification-docs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

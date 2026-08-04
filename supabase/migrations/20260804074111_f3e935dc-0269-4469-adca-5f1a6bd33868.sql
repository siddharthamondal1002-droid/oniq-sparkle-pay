-- Phase 6 — data protection for CV and education data.
-- Additive and reversible. Does NOT modify consent_records_chain(),
-- consent_records_minor_guard() or consent_records_audit().

-- 1) Career consent is 18+, not the age of digital consent.
--    Reverse with: DROP TRIGGER consent_records_career_adult_guard ON public.consent_records;
CREATE OR REPLACE FUNCTION public.consent_records_career_adult_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.purpose_id = 'career'
     AND NEW.consent_state = 'granted'
     AND NOT public.is_adult_18(NEW.user_id) THEN
    RAISE EXCEPTION 'Career and CV tools are for ages 18 and over. Nothing was saved.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.consent_records_career_adult_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS consent_records_career_adult_guard ON public.consent_records;
CREATE TRIGGER consent_records_career_adult_guard
BEFORE INSERT ON public.consent_records
FOR EACH ROW EXECUTE FUNCTION public.consent_records_career_adult_guard();

-- 2) CV data in the DSR export. Every existing key unchanged; the two new
--    keys are COALESCE'd jsonb_agg aggregates, never scalar subqueries.
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id = auth.uid()),
    'private_profile', (SELECT to_jsonb(pp) FROM public.profiles_private pp WHERE pp.user_id = auth.uid()),
    'consents', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.recorded_at DESC)
                          FROM public.user_consents c WHERE c.user_id = auth.uid()), '[]'::jsonb),
    'consent_records', COALESCE((SELECT jsonb_agg(to_jsonb(cr) ORDER BY cr.seq)
                          FROM public.consent_records cr WHERE cr.user_id = auth.uid()), '[]'::jsonb),
    'dsr_requests', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at)
                          FROM public.dsr_requests d WHERE d.user_id = auth.uid()), '[]'::jsonb),
    -- learner_profiles has no unique constraint on user_id: multiple study
    -- profiles per user are an intended feature, so this must be aggregated.
    'learner_profiles', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at)
                          FROM public.learner_profiles l WHERE l.user_id = auth.uid()), '[]'::jsonb),
    'grievances', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.created_at DESC)
                            FROM public.grievances g WHERE g.user_id = auth.uid()), '[]'::jsonb),
    -- Phase 6: career data. Aggregates for the same reason as above.
    'cv_documents', COALESCE((SELECT jsonb_agg(to_jsonb(cd) ORDER BY cd.created_at)
                            FROM public.cv_documents cd WHERE cd.user_id = auth.uid()), '[]'::jsonb),
    'cv_attestations', COALESCE((SELECT jsonb_agg(to_jsonb(ca) ORDER BY ca.attested_at)
                            FROM public.cv_attestations ca WHERE ca.user_id = auth.uid()), '[]'::jsonb)
  );
$$;
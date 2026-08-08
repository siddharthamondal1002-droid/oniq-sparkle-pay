REVOKE SELECT (key, key_verified_by, verified_at, verified_by_user, quarantine_reason, similarity_score, similarity_matched_against, provenance) ON public.assessment_item FROM authenticated;
REVOKE SELECT ON public.assessment_item FROM anon;
GRANT ALL ON public.assessment_item TO service_role;
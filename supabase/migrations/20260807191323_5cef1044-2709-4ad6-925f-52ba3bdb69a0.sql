REVOKE SELECT ON public.assessment_item FROM authenticated;
REVOKE SELECT ON public.assessment_item FROM anon;
GRANT SELECT (id, task_model_id, stem, options, key_verified_by, verified_at, verified_by_user, provenance, similarity_score, similarity_matched_against, status, quarantine_reason, created_at) ON public.assessment_item TO authenticated;
GRANT ALL ON public.assessment_item TO service_role;
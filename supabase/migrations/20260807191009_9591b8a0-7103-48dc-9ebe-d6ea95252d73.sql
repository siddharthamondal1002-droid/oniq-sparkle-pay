-- Restrict direct table reads: the child may read their own request rows,
-- but never the `code` column via the Data API.
REVOKE SELECT ON public.parental_consent_requests FROM authenticated;
REVOKE SELECT ON public.parental_consent_requests FROM anon;
REVOKE ALL ON public.parental_consent_requests FROM anon;

GRANT SELECT (id, child_user_id, method, parent_email, status, failure_reason,
              expires_at, created_at, verified_at, verifier_user_id)
  ON public.parental_consent_requests TO authenticated;

GRANT ALL ON public.parental_consent_requests TO service_role;
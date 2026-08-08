REVOKE ALL ON public.otp_attempts FROM anon, authenticated;
GRANT ALL ON public.otp_attempts TO service_role;

REVOKE ALL ON public.study_papers FROM anon, authenticated;
GRANT ALL ON public.study_papers TO service_role;
REVOKE ALL ON public.profiles FROM anon;
REVOKE SELECT (is_admin, oniq_pay_enabled) ON public.profiles FROM authenticated, anon, PUBLIC;

CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = true) AS
SELECT id, username, display_name, avatar_url, bio
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO authenticated;
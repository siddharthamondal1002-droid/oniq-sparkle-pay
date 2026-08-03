-- The project's default grants had already handed anon/authenticated blanket
-- privileges on new public tables. RLS was still blocking writes (no
-- INSERT/UPDATE/DELETE policy exists), but defence in depth: strip the
-- grants so the lockdown does not depend on policy absence alone.
REVOKE ALL ON public.dsr_requests FROM anon;
REVOKE ALL ON public.dsr_requests FROM authenticated;
GRANT SELECT ON public.dsr_requests TO authenticated;
GRANT ALL ON public.dsr_requests TO service_role;
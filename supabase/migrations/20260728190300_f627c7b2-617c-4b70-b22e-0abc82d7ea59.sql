DROP POLICY IF EXISTS profiles_update_own ON public.profiles;

CREATE POLICY profiles_update_own ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id
  AND is_admin = (SELECT p.is_admin FROM public.profiles p WHERE p.id = profiles.id)
);

REVOKE UPDATE (is_admin) ON public.profiles FROM authenticated, anon;
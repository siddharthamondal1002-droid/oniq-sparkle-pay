-- Restrict privileged lookup helpers so signed-in users can only ask about themselves.
CREATE OR REPLACE FUNCTION public.is_minor_account(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _uid IS DISTINCT FROM auth.uid()
         AND NOT public.is_admin(auth.uid())
      THEN true  -- fail closed: never reveal another user's minor status
    ELSE COALESCE(
      (SELECT CASE
         WHEN pp.date_of_birth IS NOT NULL THEN
           (date_part('year', age(current_date, pp.date_of_birth))
              < public.minor_age_for_country(p.country_code))
         ELSE pp.is_minor
       END
       FROM public.profiles_private pp
       JOIN public.profiles p ON p.id = pp.user_id
       WHERE pp.user_id = _uid),
      true)
  END;
$$;

CREATE OR REPLACE FUNCTION public.personalisation_allowed(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _uid IS DISTINCT FROM auth.uid()
         AND NOT public.is_admin(auth.uid())
      THEN false  -- fail closed for probes about other users
    ELSE _uid IS NOT NULL
      AND NOT public.is_minor_account(_uid)
      AND COALESCE((
        SELECT uc.granted FROM public.user_consents uc
        WHERE uc.user_id = _uid AND uc.purpose = 'personalisation'
        ORDER BY uc.recorded_at DESC LIMIT 1), false)
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_conversation_member(_conv uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
         AND _user IS DISTINCT FROM auth.uid()
         AND NOT public.is_admin(auth.uid())
      THEN false  -- signed-in users cannot probe other people's memberships
    ELSE EXISTS (
      SELECT 1 FROM public.conversation_members
      WHERE conversation_id = _conv AND user_id = _user)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_minor_account(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.personalisation_allowed(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid, uuid) FROM anon;
CREATE OR REPLACE FUNCTION public.user_exists(_identifier text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE lower(u.email) = lower(trim(_identifier))
       OR (
         u.phone IS NOT NULL
         AND regexp_replace(u.phone, '[^0-9]', '', 'g') =
             regexp_replace(trim(_identifier), '[^0-9]', '', 'g')
         AND length(regexp_replace(trim(_identifier), '[^0-9]', '', 'g')) >= 8
       )
  );
$$;
REVOKE EXECUTE ON FUNCTION public.user_exists(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_exists(text) TO service_role;
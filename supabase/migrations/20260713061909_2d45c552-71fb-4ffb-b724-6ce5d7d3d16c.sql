
CREATE OR REPLACE FUNCTION public.match_contacts(_phones text[])
RETURNS TABLE(id uuid, username text, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH input AS (
    SELECT DISTINCT right(regexp_replace(p, '\D', '', 'g'), 10) AS tail
    FROM unnest(COALESCE(_phones, ARRAY[]::text[])) AS p
    WHERE p IS NOT NULL
  ), tails AS (
    SELECT tail FROM input WHERE length(tail) = 10
  )
  SELECT pr.id, pr.username, pr.display_name, pr.avatar_url
  FROM auth.users u
  JOIN tails t
    ON right(regexp_replace(u.phone, '\D', '', 'g'), 10) = t.tail
  JOIN public.profiles pr ON pr.id = u.id
  WHERE auth.uid() IS NOT NULL
    AND u.phone IS NOT NULL
    AND length(regexp_replace(u.phone, '\D', '', 'g')) >= 10
    AND u.id <> auth.uid()
  LIMIT 2000;
$$;

REVOKE ALL ON FUNCTION public.match_contacts(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_contacts(text[]) TO authenticated;

-- Crawler-safe share cards (anon-callable, PUBLIC content only — a
-- moots/private post returns nothing, so OG tags never leak).
CREATE OR REPLACE FUNCTION public.public_reel_card(_clip_id uuid)
RETURNS TABLE(caption text, thumbnail_url text, username text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.caption, c.thumbnail_url, p.username, p.display_name
  FROM clips c JOIN profiles p ON p.id = c.user_id
  WHERE c.id = _clip_id AND c.visibility = 'public' AND c.is_deleted = false;
$$;
GRANT EXECUTE ON FUNCTION public.public_reel_card(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_moment_card(_post_id uuid)
RETURNS TABLE(content text, media_url text, username text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT left(m.content, 200), m.media_urls[1], p.username, p.display_name
  FROM moments_posts m JOIN profiles p ON p.id = m.user_id
  WHERE m.id = _post_id AND m.visibility = 'public' AND m.is_deleted = false;
$$;
GRANT EXECUTE ON FUNCTION public.public_moment_card(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_profile_card(_user_id uuid)
RETURNS TABLE(username text, display_name text, avatar_url text, bio text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.username, p.display_name, p.avatar_url, p.bio
  FROM profiles p WHERE p.id = _user_id;
$$;
GRANT EXECUTE ON FUNCTION public.public_profile_card(uuid) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.public_moment_card(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.public_profile_card(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.public_reel_card(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_moment_card(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_profile_card(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_reel_card(uuid) TO anon, authenticated;
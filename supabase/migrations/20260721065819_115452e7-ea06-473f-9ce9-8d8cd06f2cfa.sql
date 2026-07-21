-- Fix 1: hide upi_vpa, omiq_wallet_address, oniq_pay_enabled from generic profiles reads.
-- Owners read their own values via the existing get_my_profile_private() RPC.
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, username, display_name, avatar_url, bio, country_code, language,
  created_at, updated_at, is_admin, last_policy_notice_at,
  date_of_birth, is_minor, parent_name, parent_email, parent_phone
) ON public.profiles TO authenticated;

-- Fix 2: revoke anon EXECUTE on SECURITY DEFINER functions. All six check
-- auth.uid() internally or are triggers; none are meant to be callable
-- without a signed-in session.
REVOKE EXECUTE ON FUNCTION public.clips_feed_chrono(integer, integer)   FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_my_account()                    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.export_my_data()                       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_is_minor_self_change()         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_consent(text, boolean, text)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_signup_profile(date, text, text, text) FROM anon, PUBLIC;
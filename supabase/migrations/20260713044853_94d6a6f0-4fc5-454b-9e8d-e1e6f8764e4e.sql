-- Belt-and-braces: re-assert that sensitive payment identifiers are not
-- SELECTable by anon or authenticated at the column-privilege layer. Owners
-- still read their own values through public.get_my_profile_private().
REVOKE SELECT (upi_vpa, omiq_wallet_address, oniq_pay_enabled)
  ON public.profiles FROM anon, authenticated;

-- Explicitly grant SELECT only on the public-safe columns to authenticated
-- users. This makes the allow-list intent explicit and defends against future
-- column additions being auto-selectable via SELECT *.
GRANT SELECT (
  id, username, display_name, avatar_url, bio,
  country_code, language, is_admin,
  created_at, updated_at, last_policy_notice_at
) ON public.profiles TO authenticated;

COMMENT ON COLUMN public.profiles.upi_vpa IS
  'Payment routing identifier. Owner-only access via get_my_profile_private(). Column SELECT revoked from anon/authenticated.';
COMMENT ON COLUMN public.profiles.omiq_wallet_address IS
  'Payment routing identifier. Owner-only access via get_my_profile_private(). Column SELECT revoked from anon/authenticated.';
COMMENT ON COLUMN public.profiles.oniq_pay_enabled IS
  'Owner-only via get_my_profile_private(). Column SELECT revoked from anon/authenticated.';
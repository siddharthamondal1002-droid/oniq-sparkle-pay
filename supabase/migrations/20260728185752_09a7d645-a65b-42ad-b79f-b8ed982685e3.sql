-- Harden profiles: sensitive columns are not readable by other users.
REVOKE SELECT ON public.profiles FROM authenticated, anon;

-- Public-facing columns only
GRANT SELECT (
  id, username, display_name, avatar_url, bio, country_code, language,
  oniq_pay_enabled, created_at, updated_at, is_admin, last_policy_notice_at
) ON public.profiles TO authenticated;

-- Explicitly ensure sensitive columns have no SELECT grant
REVOKE SELECT (date_of_birth, is_minor, parent_name, parent_email, parent_phone, upi_vpa, omiq_wallet_address)
  ON public.profiles FROM authenticated, anon;
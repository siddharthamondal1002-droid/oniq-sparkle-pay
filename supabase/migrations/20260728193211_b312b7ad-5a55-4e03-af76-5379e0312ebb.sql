-- Ensure only public-facing profile columns are readable via the Data API.
REVOKE SELECT ON public.profiles FROM anon, authenticated;

GRANT SELECT (
  id, username, display_name, avatar_url, bio,
  country_code, language, oniq_pay_enabled,
  created_at, updated_at
) ON public.profiles TO authenticated;

-- Sensitive columns explicitly remain ungranted:
-- upi_vpa, omiq_wallet_address, date_of_birth, is_minor,
-- parent_name, parent_email, parent_phone, is_admin, last_policy_notice_at
REVOKE SELECT (
  upi_vpa, omiq_wallet_address, date_of_birth, is_minor,
  parent_name, parent_email, parent_phone, is_admin, last_policy_notice_at
) ON public.profiles FROM anon, authenticated;
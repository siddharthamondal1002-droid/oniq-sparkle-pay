-- Column-level lockdown for profiles.is_admin.
-- A table-wide GRANT UPDATE overrides column REVOKEs, so we drop the table-wide
-- grant and re-grant UPDATE only on the columns users are allowed to change.
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  username,
  display_name,
  avatar_url,
  bio,
  country_code,
  language,
  oniq_pay_enabled,
  omiq_wallet_address,
  upi_vpa,
  last_policy_notice_at,
  updated_at
) ON public.profiles TO authenticated;


GRANT SELECT, INSERT, DELETE ON public.profiles TO authenticated;
GRANT UPDATE (username, display_name, avatar_url, bio, country_code, language, oniq_pay_enabled, omiq_wallet_address, upi_vpa, last_policy_notice_at, updated_at, parent_name, parent_email, parent_phone) ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;

-- Age self-attestation fix.
-- date_of_birth / is_minor / parent_* must only ever be written by
-- public.set_signup_profile() (SECURITY DEFINER), which carries the rate
-- limit, the child-mode lock and the audit ledger. The original design
-- granted authenticated UPDATE on (upi_vpa, updated_at) only; a later
-- migration widened it to the whole table, letting a client PATCH its own
-- date_of_birth and skip every control. Restore column-level grants.

REVOKE UPDATE ON public.profiles_private FROM authenticated;
REVOKE INSERT ON public.profiles_private FROM authenticated;

-- The UPI-ID screen upserts { user_id, upi_vpa }; RLS still pins user_id to
-- auth.uid() on both the USING and WITH CHECK side.
GRANT INSERT (user_id, upi_vpa, updated_at) ON public.profiles_private TO authenticated;
GRANT UPDATE (user_id, upi_vpa, updated_at) ON public.profiles_private TO authenticated;

GRANT ALL ON public.profiles_private TO service_role;

COMMENT ON COLUMN public.profiles_private.date_of_birth IS
  'Set only through public.set_signup_profile(). Clients hold no INSERT or UPDATE privilege on this column: a self-declared age would bypass the rate limit, the child-mode lock and the audit ledger.';
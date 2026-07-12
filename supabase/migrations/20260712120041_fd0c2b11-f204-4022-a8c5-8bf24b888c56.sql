REVOKE EXECUTE ON FUNCTION public.delete_bank_account(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.toggle_message_star(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.profiles_prevent_privileged_change() FROM anon, PUBLIC;
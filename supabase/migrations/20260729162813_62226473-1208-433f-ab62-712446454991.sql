REVOKE ALL ON FUNCTION public.read_email_batch(text, integer, integer) FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.delete_email(text, bigint) FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.send_payment(text, numeric, text) FROM authenticated, anon, PUBLIC;
REVOKE ALL ON FUNCTION public.set_primary_bank(uuid) FROM authenticated, anon, PUBLIC;
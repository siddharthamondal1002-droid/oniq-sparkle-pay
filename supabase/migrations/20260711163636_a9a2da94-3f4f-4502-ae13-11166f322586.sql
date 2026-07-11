-- Revoke EXECUTE from anon and PUBLIC on SECURITY DEFINER functions that
-- should never be callable by unauthenticated clients.
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wipe_my_moments() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wipe_my_clips() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.wipe_my_chat_media() FROM anon, PUBLIC;

-- Keep service_role able to invoke everything, and authenticated for user-facing wipe fns.
GRANT EXECUTE ON FUNCTION public.wipe_my_moments() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wipe_my_clips() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wipe_my_chat_media() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_email(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_dispatch() TO service_role;
GRANT EXECUTE ON FUNCTION public.email_queue_wake() TO service_role;
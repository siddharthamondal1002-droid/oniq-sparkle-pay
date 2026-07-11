
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.wipe_my_clips()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := auth.uid(); n integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  WITH d AS (DELETE FROM public.clips WHERE user_id = me RETURNING 1)
  SELECT count(*) INTO n FROM d;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.wipe_my_moments()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := auth.uid(); n integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  WITH d AS (DELETE FROM public.moments_posts WHERE user_id = me RETURNING 1)
  SELECT count(*) INTO n FROM d;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.wipe_my_chat_media()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE me uuid := auth.uid(); n integer;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  WITH d AS (
    UPDATE public.messages
    SET is_deleted = true, content = '[deleted]', media_url = NULL, file_name = NULL
    WHERE sender_id = me
      AND type IN ('image','video','audio','voice','file')
      AND COALESCE(is_deleted, false) = false
    RETURNING 1
  )
  SELECT count(*) INTO n FROM d;
  RETURN n;
END; $$;

GRANT EXECUTE ON FUNCTION public.wipe_my_clips() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_my_moments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wipe_my_chat_media() TO authenticated;

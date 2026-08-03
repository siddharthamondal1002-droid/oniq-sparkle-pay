CREATE OR REPLACE FUNCTION public.request_parental_consent(
  _parent_email text, _method text DEFAULT 'adult_account')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); new_code text; row_id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_minor_account(me) THEN
    RAISE EXCEPTION 'parental consent is only for accounts under the age of digital consent';
  END IF;
  IF _method NOT IN ('adult_account','digilocker') THEN
    RAISE EXCEPTION 'unknown verification method';
  END IF;
  IF _method = 'adult_account'
     AND coalesce(_parent_email,'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'a valid parent email is required';
  END IF;

  UPDATE public.parental_consent_requests
     SET status = 'expired'
   WHERE child_user_id = me AND status = 'pending';

  -- Unambiguous 8-char code. Uniqueness among pending rows is enforced by a
  -- partial unique index; retry a few times rather than failing the caller.
  FOR i IN 1..5 LOOP
    new_code := upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 8));
    BEGIN
      INSERT INTO public.parental_consent_requests (child_user_id, parent_email, method, code)
      VALUES (me, lower(nullif(trim(_parent_email),'')), _method, new_code)
      RETURNING id INTO row_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      row_id := NULL;
    END;
  END LOOP;
  IF row_id IS NULL THEN RAISE EXCEPTION 'could not create a code, please try again'; END IF;

  RETURN jsonb_build_object('id', row_id, 'code', new_code, 'method', _method);
END; $function$;

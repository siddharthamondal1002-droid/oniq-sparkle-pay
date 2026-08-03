DROP FUNCTION IF EXISTS public.__tmp_debug_request_headers();

CREATE OR REPLACE FUNCTION public.health_request_region_ok()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  raw text;
BEGIN
  -- SIGNAL STATUS: VERIFIED-LIVE (checked 2026-08-03).
  -- A real authenticated supabase-js request from the app was observed at
  -- PostgREST carrying cf-ipcountry (value 'NL' from the test origin), so this
  -- region axis is an ACTIVE control, not a dormant one.
  --
  -- Fails OPEN on a missing header by design: absence of a signal is not a
  -- positive 'AE' signal, and the Home axis still applies independently.
  -- Because failing open is silent, a missing header is LOGGED below — that
  -- log line is the liveness check. If it starts appearing on ordinary health
  -- writes, Supabase's edge has stopped injecting cf-ipcountry and the region
  -- axis has gone dormant; re-verify before trusting it as a legal control.
  raw := upper(trim(COALESCE(current_setting('request.headers', true)::json ->> 'cf-ipcountry', '')));

  IF raw = '' THEN
    RAISE LOG 'oniq.health_region_signal_missing: cf-ipcountry absent at PostgREST; UAE region axis fell open for this request';
    RETURN true;
  END IF;

  RETURN raw <> 'AE';
END;
$$;
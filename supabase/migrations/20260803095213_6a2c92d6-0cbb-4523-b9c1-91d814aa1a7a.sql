CREATE OR REPLACE FUNCTION public.minor_age_for_country(_country text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN upper(nullif(trim(coalesce(_country, '')), '')) IN ('US','GB','AE','CA','AU','SG') THEN 13
    ELSE 18
  END
$$;

ALTER TABLE public.profiles ALTER COLUMN country_code DROP DEFAULT;
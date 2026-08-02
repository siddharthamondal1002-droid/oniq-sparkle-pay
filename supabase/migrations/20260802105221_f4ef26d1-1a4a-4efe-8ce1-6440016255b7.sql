ALTER TABLE public.user_consents DROP CONSTRAINT IF EXISTS user_consents_purpose_check;
ALTER TABLE public.user_consents ADD CONSTRAINT user_consents_purpose_check
  CHECK (purpose IN ('general','ai','location','health','personalisation'));
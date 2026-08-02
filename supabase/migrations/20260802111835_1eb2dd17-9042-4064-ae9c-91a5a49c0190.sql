-- Loop 3: durable personalisation memory (additive only)

CREATE TABLE IF NOT EXISTS public.user_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key IN (
    'favourite_hub','usual_time_band','preferred_study_subject',
    'preferred_ride_pickup','preferred_news_topic','tutor_tone'
  )),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 120),
  source text NOT NULL DEFAULT 'derived' CHECK (source IN ('derived','stated')),
  confirmed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS user_memory_user_idx ON public.user_memory (user_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_memory TO authenticated;
GRANT ALL ON public.user_memory TO service_role;

ALTER TABLE public.user_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_memory_select_own ON public.user_memory
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY user_memory_delete_own ON public.user_memory
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY user_memory_insert_eligible ON public.user_memory
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.personalisation_allowed(auth.uid()));

CREATE POLICY user_memory_update_eligible ON public.user_memory
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND public.personalisation_allowed(auth.uid()));

CREATE OR REPLACE FUNCTION public.user_memory_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_minor_account(NEW.user_id) THEN
    RAISE EXCEPTION 'personalisation disabled for minor accounts';
  END IF;
  IF NOT public.personalisation_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'personalisation consent not granted';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.user_memory_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_memory_guard_trg ON public.user_memory;
CREATE TRIGGER user_memory_guard_trg
  BEFORE INSERT OR UPDATE ON public.user_memory
  FOR EACH ROW EXECUTE FUNCTION public.user_memory_guard();

-- withdrawing personalisation consent now also erases remembered preferences
CREATE OR REPLACE FUNCTION public.personalisation_withdrawal_wipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.purpose = 'personalisation' AND NEW.granted = false THEN
    DELETE FROM public.usage_signals WHERE user_id = NEW.user_id;
    DELETE FROM public.user_memory WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.personalisation_withdrawal_wipe() FROM PUBLIC, anon, authenticated;
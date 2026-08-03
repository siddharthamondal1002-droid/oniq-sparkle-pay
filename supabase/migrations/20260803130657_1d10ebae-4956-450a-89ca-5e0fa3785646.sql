-- Retroactive child mode: when an account is found to be under the age of
-- digital consent, erase personalisation/profiling data already held for it.
-- Additive and reversible:
--   DROP TRIGGER trg_minor_flip_wipe ON public.profiles_private;
--   DROP FUNCTION public.minor_flip_personalisation_wipe();
CREATE OR REPLACE FUNCTION public.minor_flip_personalisation_wipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_minor AND COALESCE(OLD.is_minor, false) = false THEN
    DELETE FROM public.usage_signals WHERE user_id = NEW.user_id;
    DELETE FROM public.user_memory  WHERE user_id = NEW.user_id;
    UPDATE public.user_consents
       SET granted = false, recorded_at = now(), source = 'minor-flip-auto-withdraw'
     WHERE user_id = NEW.user_id AND purpose = 'personalisation' AND granted;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_minor_flip_wipe ON public.profiles_private;
CREATE TRIGGER trg_minor_flip_wipe
AFTER UPDATE OF is_minor ON public.profiles_private
FOR EACH ROW EXECUTE FUNCTION public.minor_flip_personalisation_wipe();
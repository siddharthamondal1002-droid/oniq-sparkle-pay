-- Reversible: DROP FUNCTION public.is_adult_18(uuid);
CREATE OR REPLACE FUNCTION public.is_adult_18(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid()
         AND NOT public.is_admin(auth.uid()) THEN false
    ELSE COALESCE(
      (SELECT pp.date_of_birth IS NOT NULL
          AND date_part('year', age(current_date, pp.date_of_birth)) >= 18
       FROM public.profiles_private pp WHERE pp.user_id = _uid),
      false)
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_adult_18(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_adult_18(uuid) TO authenticated, service_role;

-- Reversible: DROP TABLE public.cv_documents;
CREATE TABLE public.cv_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'My CV',
  target_country text NOT NULL DEFAULT 'IN',
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cv_documents TO authenticated;
GRANT ALL ON public.cv_documents TO service_role;

ALTER TABLE public.cv_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_documents owner select" ON public.cv_documents
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cv_documents owner insert" ON public.cv_documents
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_documents owner update" ON public.cv_documents
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cv_documents owner delete" ON public.cv_documents
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "cv_documents adults only" ON public.cv_documents
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_adult_18(auth.uid()))
  WITH CHECK (public.is_adult_18(auth.uid()));

CREATE TRIGGER trg_cv_documents_updated_at
  BEFORE UPDATE ON public.cv_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Reversible: DROP TABLE public.cv_attestations;
CREATE TABLE public.cv_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cv_id uuid NOT NULL REFERENCES public.cv_documents(id) ON DELETE CASCADE,
  attested_at timestamptz NOT NULL DEFAULT now(),
  statement text NOT NULL
);

GRANT SELECT, INSERT ON public.cv_attestations TO authenticated;
GRANT ALL ON public.cv_attestations TO service_role;

ALTER TABLE public.cv_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cv_attestations owner select" ON public.cv_attestations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "cv_attestations owner insert" ON public.cv_attestations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cv_attestations adults only" ON public.cv_attestations
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.is_adult_18(auth.uid()))
  WITH CHECK (public.is_adult_18(auth.uid()));
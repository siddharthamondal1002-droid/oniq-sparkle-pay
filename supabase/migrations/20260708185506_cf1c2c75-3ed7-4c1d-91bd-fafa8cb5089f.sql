
-- user_theme table
CREATE TABLE IF NOT EXISTS public.user_theme (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  wallpaper_url text,
  tile_skins jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.user_theme TO authenticated;
GRANT ALL ON public.user_theme TO service_role;

ALTER TABLE public.user_theme ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_theme select own" ON public.user_theme;
CREATE POLICY "user_theme select own" ON public.user_theme
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_theme insert own" ON public.user_theme;
CREATE POLICY "user_theme insert own" ON public.user_theme
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_theme update own" ON public.user_theme;
CREATE POLICY "user_theme update own" ON public.user_theme
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Storage policies for themes bucket (bucket itself created via storage tool)
DROP POLICY IF EXISTS "themes insert own folder" ON storage.objects;
CREATE POLICY "themes insert own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'themes'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(split_part(name, '.', array_length(string_to_array(name, '.'), 1))) IN ('jpg','jpeg','png','webp')
  );

DROP POLICY IF EXISTS "themes select own folder" ON storage.objects;
CREATE POLICY "themes select own folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'themes' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "themes delete own folder" ON storage.objects;
CREATE POLICY "themes delete own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'themes' AND (storage.foldername(name))[1] = auth.uid()::text);

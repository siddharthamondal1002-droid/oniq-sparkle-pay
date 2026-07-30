DROP POLICY IF EXISTS "moments delete own" ON storage.objects;
CREATE POLICY "moments delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'moments'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
DROP POLICY IF EXISTS "clips_storage_insert_own" ON storage.objects;
CREATE POLICY "clips_storage_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'clips'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(coalesce(storage.extension(name), '')) IN ('mp4','webm','mov')
  );

DROP POLICY IF EXISTS "moments upload own folder" ON storage.objects;
CREATE POLICY "moments upload own folder" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'moments'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND lower(coalesce(storage.extension(name), '')) IN ('jpg','jpeg','png','webp','gif')
  );
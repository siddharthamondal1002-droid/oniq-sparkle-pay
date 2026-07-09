DROP POLICY IF EXISTS clips_storage_read ON storage.objects;

CREATE POLICY clips_storage_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'clips'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.is_deleted = false
        AND (
          c.video_url LIKE '%/' || storage.objects.name
          OR c.video_url LIKE '%/' || storage.objects.name || '?%'
        )
    )
  )
);
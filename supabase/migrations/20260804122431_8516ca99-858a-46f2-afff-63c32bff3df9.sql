DROP POLICY IF EXISTS clips_storage_read ON storage.objects;

CREATE POLICY clips_storage_read ON storage.objects
FOR SELECT
USING (
  bucket_id = 'clips'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.is_deleted = false
        AND (c.video_url LIKE ('%/' || objects.name) OR c.video_url LIKE ('%/' || objects.name || '?%'))
        AND (
          c.visibility = 'public'
          OR (
            c.visibility = 'moots'
            AND EXISTS (
              SELECT 1 FROM public.friendships f
              WHERE f.status = 'accepted'
                AND (
                  (f.user_a = auth.uid() AND f.user_b = c.user_id)
                  OR (f.user_b = auth.uid() AND f.user_a = c.user_id)
                )
            )
          )
        )
    )
  )
);
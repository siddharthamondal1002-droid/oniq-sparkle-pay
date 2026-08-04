-- Exact object-path extraction from a stored public/signed storage URL.
CREATE OR REPLACE FUNCTION public.storage_object_name(url text, bucket text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN url IS NULL OR bucket IS NULL THEN NULL
    WHEN position('/' || bucket || '/' in split_part(url, '?', 1)) > 0
      THEN substr(
        split_part(url, '?', 1),
        position('/' || bucket || '/' in split_part(url, '?', 1)) + length(bucket) + 2
      )
    ELSE split_part(url, '?', 1)
  END
$$;

REVOKE ALL ON FUNCTION public.storage_object_name(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_object_name(text, text) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "clips_storage_read" ON storage.objects;
CREATE POLICY "clips_storage_read"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'clips'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1
      FROM public.clips c
      WHERE c.is_deleted = false
        AND public.storage_object_name(c.video_url, 'clips') = objects.name
        AND (storage.foldername(objects.name))[1] = c.user_id::text
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

DROP POLICY IF EXISTS "moments read scoped to post visibility" ON storage.objects;
CREATE POLICY "moments read scoped to post visibility"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'moments'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.moments_posts p
      WHERE p.is_deleted = false
        AND (p.visibility = 'public' OR p.user_id = auth.uid())
        AND EXISTS (
          SELECT 1 FROM unnest(p.media_urls) AS u(u)
          WHERE public.storage_object_name(u.u, 'moments') = objects.name
        )
        AND (storage.foldername(objects.name))[1] = p.user_id::text
    )
  )
);
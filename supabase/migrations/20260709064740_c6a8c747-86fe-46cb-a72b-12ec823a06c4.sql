DROP POLICY IF EXISTS "moments read authenticated" ON storage.objects;

CREATE POLICY "moments read scoped to post visibility"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'moments'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.moments_posts p
      WHERE (p.visibility = 'public' OR p.user_id = auth.uid())
        AND EXISTS (
          SELECT 1
          FROM unnest(p.media_urls) AS u
          WHERE u LIKE '%' || storage.objects.name || '%'
        )
    )
  )
);
DROP POLICY IF EXISTS moments_select ON public.moments_posts;
CREATE POLICY moments_select ON public.moments_posts
FOR SELECT
USING (
  is_deleted = false
  AND (
    user_id = auth.uid()
    OR visibility = 'public'
    OR (
      visibility = 'moots' AND EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND ((f.user_a = auth.uid() AND f.user_b = moments_posts.user_id)
            OR (f.user_b = auth.uid() AND f.user_a = moments_posts.user_id))
      )
    )
  )
);

DROP POLICY IF EXISTS comments_select_visible ON public.moments_comments;
CREATE POLICY comments_select_visible ON public.moments_comments
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.moments_posts p
    WHERE p.id = moments_comments.post_id
      AND p.is_deleted = false
      AND (p.visibility = 'public' OR p.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS likes_select_visible ON public.moments_likes;
CREATE POLICY likes_select_visible ON public.moments_likes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.moments_posts p
    WHERE p.id = moments_likes.post_id
      AND p.is_deleted = false
      AND (p.visibility = 'public' OR p.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS "moments read scoped to post visibility" ON storage.objects;
CREATE POLICY "moments read scoped to post visibility" ON storage.objects
FOR SELECT
USING (
  bucket_id = 'moments'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.moments_posts p
      WHERE p.is_deleted = false
        AND (p.visibility = 'public' OR p.user_id = auth.uid())
        AND EXISTS (
          SELECT 1 FROM unnest(p.media_urls) u(u)
          WHERE u.u LIKE '%' || objects.name || '%'
        )
    )
  )
);
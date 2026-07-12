DROP POLICY IF EXISTS clip_likes_select ON public.clips_likes;
DROP POLICY IF EXISTS clips_likes_select ON public.clips_likes;
CREATE POLICY clips_likes_select ON public.clips_likes
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.clips c
  WHERE c.id = clips_likes.clip_id
    AND c.is_deleted = false
    AND (
      c.user_id = auth.uid()
      OR c.visibility = 'public'
      OR (c.visibility = 'moots' AND EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted'
          AND ((f.user_a = auth.uid() AND f.user_b = c.user_id)
            OR (f.user_b = auth.uid() AND f.user_a = c.user_id))
      ))
    )
));
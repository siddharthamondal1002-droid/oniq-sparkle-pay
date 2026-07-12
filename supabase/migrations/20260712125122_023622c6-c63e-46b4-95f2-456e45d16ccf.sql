DROP POLICY IF EXISTS clip_comments_select ON public.clips_comments;
CREATE POLICY clip_comments_select ON public.clips_comments
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.clips c
  WHERE c.id = clips_comments.clip_id
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
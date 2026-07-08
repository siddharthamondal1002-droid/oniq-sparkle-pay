-- Scope clip comments visibility to non-deleted clips
DROP POLICY IF EXISTS clip_comments_select ON public.clips_comments;
CREATE POLICY clip_comments_select ON public.clips_comments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.id = clips_comments.clip_id AND c.is_deleted = FALSE
    )
  );

-- Scope clip likes visibility to non-deleted clips
DROP POLICY IF EXISTS clip_likes_select ON public.clips_likes;
CREATE POLICY clip_likes_select ON public.clips_likes
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clips c
      WHERE c.id = clips_likes.clip_id AND c.is_deleted = FALSE
    )
  );
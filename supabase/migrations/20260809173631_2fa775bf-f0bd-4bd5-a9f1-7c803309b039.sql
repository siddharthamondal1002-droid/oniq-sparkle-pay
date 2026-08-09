-- clips_likes: explicit owner-scoped write policies
CREATE POLICY "clips_likes_insert_own" ON public.clips_likes
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
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
    )
  );

CREATE POLICY "clips_likes_delete_own" ON public.clips_likes
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- clips_views: only the viewer may record their own view
CREATE POLICY "clips_views_insert_own" ON public.clips_views
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- grievances: admins may update (resolve) grievance records
CREATE POLICY "grievances_update_admin" ON public.grievances
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS "clips_update_own" ON public.clips;
CREATE POLICY "clips_update_own" ON public.clips
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "moments_update_own" ON public.moments_posts;
CREATE POLICY "moments_update_own" ON public.moments_posts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
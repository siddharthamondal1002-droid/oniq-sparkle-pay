DROP POLICY IF EXISTS "views readable" ON public.content_views;
CREATE POLICY "content_views_select_own_or_owner" ON public.content_views
FOR SELECT TO authenticated
USING (
  viewer_id = auth.uid()
  OR public.is_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = content_views.channel_id
      AND c.created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "runs readable" ON public.creator_payout_runs;
CREATE POLICY "creator_payout_runs_admin_select" ON public.creator_payout_runs
FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.creator_payout_runs FROM anon, authenticated;
REVOKE SELECT ON public.creator_payout_runs FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.content_views FROM anon;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.content_views FROM authenticated;
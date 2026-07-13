
CREATE TABLE public.call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  caller_id uuid NOT NULL,
  callee_ids uuid[] NOT NULL DEFAULT '{}',
  call_type text NOT NULL CHECK (call_type IN ('audio','video')),
  status text NOT NULL CHECK (status IN ('missed','answered','declined','no_answer')),
  started_at timestamptz NOT NULL DEFAULT now(),
  duration_s integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.call_logs TO authenticated;
GRANT ALL ON public.call_logs TO service_role;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants read call_logs" ON public.call_logs FOR SELECT TO authenticated
  USING (caller_id = auth.uid() OR auth.uid() = ANY(callee_ids));
CREATE POLICY "caller inserts call_logs" ON public.call_logs FOR INSERT TO authenticated
  WITH CHECK (caller_id = auth.uid());
CREATE POLICY "participants update call_logs" ON public.call_logs FOR UPDATE TO authenticated
  USING (caller_id = auth.uid() OR auth.uid() = ANY(callee_ids))
  WITH CHECK (caller_id = auth.uid() OR auth.uid() = ANY(callee_ids));
CREATE INDEX call_logs_conv_idx ON public.call_logs (conversation_id, created_at DESC);
CREATE INDEX call_logs_caller_idx ON public.call_logs (caller_id, created_at DESC);
CREATE INDEX call_logs_callees_idx ON public.call_logs USING gin (callee_ids);

CREATE TABLE public.status_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text','image')),
  content text,
  media_url text,
  bg_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.status_updates TO authenticated;
GRANT ALL ON public.status_updates TO service_role;
ALTER TABLE public.status_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages own status" ON public.status_updates FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "moots read active status" ON public.status_updates FOR SELECT TO authenticated
  USING (
    expires_at > now() AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.friendships f
        WHERE f.status = 'accepted' AND (
          (f.user_a = auth.uid() AND f.user_b = status_updates.user_id) OR
          (f.user_b = auth.uid() AND f.user_a = status_updates.user_id)
        )
      )
    )
  );
CREATE INDEX status_updates_user_idx ON public.status_updates (user_id, created_at DESC);
CREATE INDEX status_updates_expires_idx ON public.status_updates (expires_at);

CREATE TABLE public.status_views (
  status_id uuid NOT NULL REFERENCES public.status_updates(id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (status_id, viewer_id)
);
GRANT SELECT, INSERT ON public.status_views TO authenticated;
GRANT ALL ON public.status_views TO service_role;
ALTER TABLE public.status_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "viewer inserts own view" ON public.status_views FOR INSERT TO authenticated
  WITH CHECK (viewer_id = auth.uid());
CREATE POLICY "viewer reads own views" ON public.status_views FOR SELECT TO authenticated
  USING (viewer_id = auth.uid());
CREATE POLICY "owner reads views of own status" ON public.status_views FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.status_updates s WHERE s.id = status_views.status_id AND s.user_id = auth.uid()));


-- ============ profiles: admin flag + policy notice timestamp ============
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_policy_notice_at timestamptz NULL;

UPDATE public.profiles SET is_admin = true
WHERE id = 'd3b58345-b17d-4322-a81c-751965c226af';

-- Security-definer helper (avoids RLS recursion when policies check admin).
CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = _uid), false) $$;

-- ============ messages: AI-generated flag ============
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_ai boolean NOT NULL DEFAULT false;

-- ============ reports ============
CREATE TABLE IF NOT EXISTS public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('message','user','clip','moment')),
  target_id text NOT NULL,
  conversation_id uuid NULL,
  reason text NOT NULL CHECK (reason IN ('spam','harassment','impersonation','sexual_content','violence','ai_deepfake','other')),
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text
);
GRANT SELECT, INSERT, UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reports insert own" ON public.reports;
CREATE POLICY "reports insert own" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS "reports select own or admin" ON public.reports;
CREATE POLICY "reports select own or admin" ON public.reports
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "reports update admin" ON public.reports;
CREATE POLICY "reports update admin" ON public.reports
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS reports_status_created_idx ON public.reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS reports_reporter_idx ON public.reports (reporter_id, created_at DESC);

-- ============ blocked_users ============
CREATE TABLE IF NOT EXISTS public.blocked_users (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
GRANT SELECT, INSERT, DELETE ON public.blocked_users TO authenticated;
GRANT ALL ON public.blocked_users TO service_role;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocked_users own select" ON public.blocked_users;
CREATE POLICY "blocked_users own select" ON public.blocked_users
  FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "blocked_users own insert" ON public.blocked_users;
CREATE POLICY "blocked_users own insert" ON public.blocked_users
  FOR INSERT TO authenticated
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "blocked_users own delete" ON public.blocked_users;
CREATE POLICY "blocked_users own delete" ON public.blocked_users
  FOR DELETE TO authenticated
  USING (blocker_id = auth.uid());

-- ============ admin_actions ============
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.admin_actions TO authenticated;
GRANT ALL ON public.admin_actions TO service_role;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_actions admin select" ON public.admin_actions;
CREATE POLICY "admin_actions admin select" ON public.admin_actions
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "admin_actions admin insert" ON public.admin_actions;
CREATE POLICY "admin_actions admin insert" ON public.admin_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) AND admin_id = auth.uid());

-- ============ RPC: dismiss policy notice ============
CREATE OR REPLACE FUNCTION public.mark_policy_notice_seen()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ UPDATE public.profiles SET last_policy_notice_at = now() WHERE id = auth.uid() $$;

-- ============ RPC: admin remove content (message or clip) ============
CREATE OR REPLACE FUNCTION public.admin_remove_content(_target_type text, _target_id text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF NOT public.is_admin(me) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _target_type = 'message' THEN
    UPDATE public.messages SET is_deleted = true, content = '[removed by moderator]'
      WHERE id = _target_id::uuid;
  ELSIF _target_type = 'clip' THEN
    UPDATE public.clips SET is_deleted = true WHERE id = _target_id::uuid;
  ELSIF _target_type = 'moment' THEN
    DELETE FROM public.moments_posts WHERE id = _target_id::uuid;
  END IF;
  INSERT INTO public.admin_actions (admin_id, action, target_type, target_id, note)
    VALUES (me, 'remove_content', _target_type, _target_id, _note);
END; $$;

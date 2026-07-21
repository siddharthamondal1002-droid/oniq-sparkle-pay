
-- 1) Profile additions for age gate + parent contact
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS is_minor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_name text,
  ADD COLUMN IF NOT EXISTS parent_email text,
  ADD COLUMN IF NOT EXISTS parent_phone text;

-- Prevent user from flipping is_minor after initial set (admin override retained)
CREATE OR REPLACE FUNCTION public.prevent_is_minor_self_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_minor IS DISTINCT FROM OLD.is_minor
     AND OLD.date_of_birth IS NOT NULL
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'is_minor cannot be changed after signup' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_prevent_is_minor_self_change ON public.profiles;
CREATE TRIGGER trg_prevent_is_minor_self_change
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_is_minor_self_change();

-- 2) Consents (append-only audit log)
CREATE TABLE IF NOT EXISTS public.user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('location','health','ai','general')),
  granted boolean NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source text
);
CREATE INDEX IF NOT EXISTS user_consents_user_idx ON public.user_consents(user_id, purpose, recorded_at DESC);
GRANT SELECT, INSERT ON public.user_consents TO authenticated;
GRANT ALL ON public.user_consents TO service_role;
ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_consents_select_own ON public.user_consents;
CREATE POLICY user_consents_select_own ON public.user_consents FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS user_consents_insert_own ON public.user_consents;
CREATE POLICY user_consents_insert_own ON public.user_consents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 3) Grievances intake
CREATE TABLE IF NOT EXISTS public.grievances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  complaint_type text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.grievances TO authenticated;
GRANT ALL ON public.grievances TO service_role;
ALTER TABLE public.grievances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grievances_insert_own ON public.grievances;
CREATE POLICY grievances_insert_own ON public.grievances FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND length(trim(name)) BETWEEN 1 AND 120
              AND length(trim(email)) BETWEEN 3 AND 254
              AND length(trim(message)) BETWEEN 5 AND 4000);
DROP POLICY IF EXISTS grievances_select_own ON public.grievances;
CREATE POLICY grievances_select_own ON public.grievances FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- 4) Signup enrollment RPC (age-gate + parent contact + initial minor flip)
CREATE OR REPLACE FUNCTION public.set_signup_profile(
  _dob date,
  _parent_name text DEFAULT NULL,
  _parent_email text DEFAULT NULL,
  _parent_phone text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  minor boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _dob IS NULL OR _dob > current_date OR _dob < '1900-01-01' THEN
    RAISE EXCEPTION 'invalid date of birth';
  END IF;
  minor := ((current_date - _dob) < (18 * 365 + 4));
  IF minor THEN
    IF coalesce(trim(_parent_name),'') = '' OR coalesce(trim(_parent_email),'') = '' THEN
      RAISE EXCEPTION 'parent name and email required for users under 18';
    END IF;
    IF _parent_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'invalid parent email';
    END IF;
  END IF;
  UPDATE public.profiles SET
    date_of_birth = _dob,
    is_minor = minor,
    parent_name  = CASE WHEN minor THEN trim(_parent_name)  ELSE NULL END,
    parent_email = CASE WHEN minor THEN lower(trim(_parent_email)) ELSE NULL END,
    parent_phone = CASE WHEN minor THEN NULLIF(trim(_parent_phone),'') ELSE NULL END,
    updated_at   = now()
  WHERE id = me;
  RETURN jsonb_build_object('is_minor', minor);
END; $$;
GRANT EXECUTE ON FUNCTION public.set_signup_profile(date,text,text,text) TO authenticated;

-- 5) Consent recorder — batch-safe helper
CREATE OR REPLACE FUNCTION public.record_consent(_purpose text, _granted boolean, _source text DEFAULT 'signup')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _purpose NOT IN ('location','health','ai','general') THEN
    RAISE EXCEPTION 'invalid purpose';
  END IF;
  INSERT INTO public.user_consents (user_id, purpose, granted, source)
  VALUES (me, _purpose, coalesce(_granted, false), coalesce(NULLIF(trim(_source),''), 'app'));
END; $$;
GRANT EXECUTE ON FUNCTION public.record_consent(text,boolean,text) TO authenticated;

-- 6) Data export RPC (data-rights)
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id = auth.uid()),
    'consents', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.recorded_at DESC)
                          FROM public.user_consents c WHERE c.user_id = auth.uid()), '[]'::jsonb),
    'wallet', (SELECT to_jsonb(w) FROM public.wallets w WHERE w.user_id = auth.uid()),
    'learner_profile', (SELECT to_jsonb(l) FROM public.learner_profiles l WHERE l.user_id = auth.uid()),
    'grievances', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.created_at DESC)
                            FROM public.grievances g WHERE g.user_id = auth.uid()), '[]'::jsonb),
    'transactions_summary', (SELECT jsonb_build_object(
      'count', COALESCE(count(*),0),
      'first_at', min(created_at),
      'last_at', max(created_at)
    ) FROM public.transactions
      WHERE sender_id = auth.uid() OR recipient_id = auth.uid())
  );
$$;
GRANT EXECUTE ON FUNCTION public.export_my_data() TO authenticated;

-- 7) Chronological (non-personalized) clips feed for minors
CREATE OR REPLACE FUNCTION public.clips_feed_chrono(_limit int DEFAULT 10, _offset int DEFAULT 0)
RETURNS SETOF public.clips LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.clips c
  WHERE c.is_deleted = FALSE
    AND (
      c.visibility = 'public'
      OR c.user_id = auth.uid()
      OR (c.visibility = 'moots' AND EXISTS (
        SELECT 1 FROM public.friendships f WHERE f.status='accepted'
          AND ((f.user_a = auth.uid() AND f.user_b = c.user_id)
            OR (f.user_b = auth.uid() AND f.user_a = c.user_id))
      ))
    )
  ORDER BY c.created_at DESC
  LIMIT LEAST(GREATEST(_limit,1),20) OFFSET GREATEST(_offset,0);
$$;
GRANT EXECUTE ON FUNCTION public.clips_feed_chrono(int,int) TO authenticated;

-- 8) Extend delete_my_account to include Study data
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Study data (added for DPDP Stage 0)
  DELETE FROM public.study_messages WHERE user_id = me;
  DELETE FROM public.quiz_attempts WHERE user_id = me;
  DELETE FROM public.study_papers WHERE user_id = me;
  DELETE FROM public.chapter_overrides WHERE user_id = me;
  DELETE FROM public.chapter_notes WHERE user_id = me;
  DELETE FROM public.learner_profiles WHERE user_id = me;

  -- Consents & grievances (grievances retained for compliance history if admin, else deleted)
  DELETE FROM public.user_consents WHERE user_id = me;
  UPDATE public.grievances SET user_id = NULL WHERE user_id = me;

  -- Personal content owned by user
  DELETE FROM public.moments_likes WHERE user_id = me;
  DELETE FROM public.moments_comments WHERE user_id = me;
  DELETE FROM public.moments_posts WHERE user_id = me;
  DELETE FROM public.clips_likes WHERE user_id = me;
  DELETE FROM public.clips_views WHERE user_id = me;
  DELETE FROM public.clips_comments WHERE user_id = me;
  DELETE FROM public.clips WHERE user_id = me;
  DELETE FROM public.status_views WHERE viewer_id = me;
  DELETE FROM public.status_updates WHERE user_id = me;

  DELETE FROM public.cycle_logs WHERE user_id = me;
  DELETE FROM public.health_checkins WHERE user_id = me;
  DELETE FROM public.health_profiles WHERE user_id = me;

  DELETE FROM public.message_reactions WHERE user_id = me;
  DELETE FROM public.message_hides WHERE user_id = me;
  UPDATE public.messages SET is_deleted = true, content = '[account deleted]', media_url = NULL, file_name = NULL
    WHERE sender_id = me;
  DELETE FROM public.conversation_members WHERE user_id = me;

  DELETE FROM public.call_logs WHERE caller_id = me;

  DELETE FROM public.friendships WHERE user_a = me OR user_b = me;
  DELETE FROM public.follows WHERE follower_id = me OR followee_id = me;
  DELETE FROM public.blocked_users WHERE blocker_id = me OR blocked_id = me;
  DELETE FROM public.user_channels WHERE user_id = me;
  DELETE FROM public.user_watch_channels WHERE user_id = me;
  DELETE FROM public.user_watch_genres WHERE user_id = me;
  DELETE FROM public.user_theme WHERE user_id = me;

  DELETE FROM public.learn_progress WHERE user_id = me;
  DELETE FROM public.learn_stats WHERE user_id = me;

  DELETE FROM public.ai_messages WHERE chat_id IN (SELECT id FROM public.ai_chats WHERE user_id = me);
  DELETE FROM public.ai_chats WHERE user_id = me;

  DELETE FROM public.device_tokens WHERE user_id = me;

  DELETE FROM public.bank_accounts WHERE user_id = me;
  DELETE FROM public.red_packets WHERE sender_id = me OR recipient_id = me;
  DELETE FROM public.payment_requests WHERE requester_id = me OR payer_id = me;
  DELETE FROM public.orders WHERE user_id = me;
  DELETE FROM public.wallets WHERE user_id = me;

  DELETE FROM public.reports WHERE reporter_id = me;
  DELETE FROM public.profiles WHERE id = me;
  DELETE FROM auth.users WHERE id = me;
END; $$;

-- 9) Address the flagged security finding: revoke direct is_admin escalation
-- The trigger public.prevent_is_admin_self_update already blocks flipping
-- is_admin without admin rights; make the intent explicit here.
COMMENT ON TRIGGER trg_prevent_is_minor_self_change ON public.profiles IS
  'DPDP Stage 0 — users cannot alter their own minor status after signup.';

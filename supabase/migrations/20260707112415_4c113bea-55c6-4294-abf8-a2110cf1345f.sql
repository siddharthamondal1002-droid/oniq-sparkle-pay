
-- ===== profiles: hide sensitive columns from non-owners =====
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, created_at, updated_at)
  ON public.profiles TO authenticated;
GRANT SELECT (id, username, display_name, avatar_url, bio, country_code, language, created_at, updated_at)
  ON public.profiles TO anon;
-- Owner still needs update/insert on all columns via existing policies
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_profile_private()
RETURNS TABLE(upi_vpa text, omiq_wallet_address text, oniq_pay_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT upi_vpa, omiq_wallet_address, oniq_pay_enabled
  FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_profile_private() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_private() TO authenticated;

-- ===== bank_accounts: add INSERT/UPDATE owner policies =====
CREATE POLICY "banks_insert_own" ON public.bank_accounts
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "banks_update_own" ON public.bank_accounts
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ===== conversations: creator can update/delete =====
CREATE POLICY "conversations_update_creator" ON public.conversations
  FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY "conversations_delete_creator" ON public.conversations
  FOR DELETE TO authenticated USING (created_by = auth.uid());

-- ===== menu_items: require authentication =====
DROP POLICY IF EXISTS "menu_no_alcohol" ON public.menu_items;
CREATE POLICY "menu_no_alcohol_auth" ON public.menu_items
  FOR SELECT TO authenticated
  USING (is_available = true AND contains_alcohol = false);

-- ===== moments_comments: gate by post visibility =====
DROP POLICY IF EXISTS "comments_select" ON public.moments_comments;
CREATE POLICY "comments_select_visible" ON public.moments_comments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.moments_posts p
    WHERE p.id = moments_comments.post_id
      AND (p.visibility = 'public' OR p.user_id = auth.uid())
  ));

-- ===== moments_likes: gate by post visibility =====
DROP POLICY IF EXISTS "likes_select" ON public.moments_likes;
CREATE POLICY "likes_select_visible" ON public.moments_likes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.moments_posts p
    WHERE p.id = moments_likes.post_id
      AND (p.visibility = 'public' OR p.user_id = auth.uid())
  ));

-- ===== payment_requests: INSERT/UPDATE policies =====
CREATE POLICY "payreq_insert_requester" ON public.payment_requests
  FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());
CREATE POLICY "payreq_update_parties" ON public.payment_requests
  FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() OR payer_id = auth.uid())
  WITH CHECK (requester_id = auth.uid() OR payer_id = auth.uid());

-- ===== red_packets: INSERT/UPDATE policies =====
CREATE POLICY "redpacket_insert_sender" ON public.red_packets
  FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());
CREATE POLICY "redpacket_update_parties" ON public.red_packets
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR recipient_id = auth.uid());

-- ===== SECURITY DEFINER functions: revoke from anon/public =====
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN (
        'add_bank_account','create_payment_request','demo_top_up',
        'find_or_create_direct_conversation','mark_conversation_read',
        'open_red_packet','place_order','reclaim_red_packet',
        'respond_payment_request','send_payment','send_red_packet',
        'set_primary_bank','toggle_moment_like','withdraw_to_bank',
        'is_conversation_member','unread_count'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END $$;

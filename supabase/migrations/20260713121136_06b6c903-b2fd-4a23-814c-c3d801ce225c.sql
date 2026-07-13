
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

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

  -- Health
  DELETE FROM public.cycle_logs WHERE user_id = me;
  DELETE FROM public.health_checkins WHERE user_id = me;
  DELETE FROM public.health_profiles WHERE user_id = me;

  -- Chat / messaging
  DELETE FROM public.message_reactions WHERE user_id = me;
  DELETE FROM public.message_hides WHERE user_id = me;
  UPDATE public.messages SET is_deleted = true, content = '[account deleted]', media_url = NULL, file_name = NULL
    WHERE sender_id = me;
  DELETE FROM public.conversation_members WHERE user_id = me;

  -- Calls (protected stack: no logic change, only remove caller's own log rows)
  DELETE FROM public.call_logs WHERE caller_id = me;

  -- Social graph
  DELETE FROM public.friendships WHERE user_a = me OR user_b = me;
  DELETE FROM public.follows WHERE follower_id = me OR followee_id = me;
  DELETE FROM public.blocked_users WHERE blocker_id = me OR blocked_id = me;
  DELETE FROM public.user_channels WHERE user_id = me;
  DELETE FROM public.user_watch_channels WHERE user_id = me;
  DELETE FROM public.user_watch_genres WHERE user_id = me;
  DELETE FROM public.user_theme WHERE user_id = me;

  -- Learn
  DELETE FROM public.learn_progress WHERE user_id = me;
  DELETE FROM public.learn_stats WHERE user_id = me;

  -- AI
  DELETE FROM public.ai_messages WHERE chat_id IN (SELECT id FROM public.ai_chats WHERE user_id = me);
  DELETE FROM public.ai_chats WHERE user_id = me;

  -- Device push tokens
  DELETE FROM public.device_tokens WHERE user_id = me;

  -- Wallet / payments (retained transactions per India IT rules — anonymize by removing FK to profile via cascade)
  DELETE FROM public.bank_accounts WHERE user_id = me;
  DELETE FROM public.red_packets WHERE sender_id = me OR recipient_id = me;
  DELETE FROM public.payment_requests WHERE requester_id = me OR payer_id = me;
  DELETE FROM public.orders WHERE user_id = me;
  DELETE FROM public.wallets WHERE user_id = me;
  -- transactions retained for compliance (references cascade on auth.users delete below if FK set)

  -- Reports authored by this user (keep reports filed against them for safety history)
  DELETE FROM public.reports WHERE reporter_id = me;

  -- Profile row
  DELETE FROM public.profiles WHERE id = me;

  -- Finally, the auth user itself
  DELETE FROM auth.users WHERE id = me;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

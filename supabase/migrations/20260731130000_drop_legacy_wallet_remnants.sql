-- Decommission the legacy in-app wallet (pre-launch demo era).
-- No client code references any of these objects; real money has always moved
-- via upi:// deep links handled by the user's own UPI app, never through ONIQ.
-- The _archive_ tables held only pre-launch demo rows.

DROP FUNCTION IF EXISTS public.send_payment(_recipient_username text, _amount numeric, _note text);
DROP FUNCTION IF EXISTS public.set_primary_bank(_bank_id uuid);
DROP TABLE IF EXISTS public._archive_payment_requests;
DROP TABLE IF EXISTS public._archive_red_packets;
DROP TABLE IF EXISTS public._archive_transactions;
DROP TABLE IF EXISTS public._archive_wallets;

-- export_my_data still selected from public.wallets / public.transactions,
-- which no longer exist — so the DPDP "Download my data" export errored at
-- runtime. Recreate without wallet-era references, and include the
-- profiles_private row (upi_vpa, dob, parent contacts) that the old export
-- missed after the PII split.
CREATE OR REPLACE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id = auth.uid()),
    'private_profile', (SELECT to_jsonb(pp) FROM public.profiles_private pp WHERE pp.user_id = auth.uid()),
    'consents', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.recorded_at DESC)
                          FROM public.user_consents c WHERE c.user_id = auth.uid()), '[]'::jsonb),
    'learner_profile', (SELECT to_jsonb(l) FROM public.learner_profiles l WHERE l.user_id = auth.uid()),
    'grievances', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.created_at DESC)
                            FROM public.grievances g WHERE g.user_id = auth.uid()), '[]'::jsonb)
  );
$function$;

-- delete_my_account likewise deleted from bank_accounts / red_packets /
-- payment_requests / wallets (all dropped), so account deletion failed at
-- runtime partway through. It also filtered study tables on a user_id column
-- they don't have (they key on learner profile and cascade from
-- learner_profiles), and deleted from chapter_notes, which is shared
-- curriculum content with no user column. Recreate without all of that.
-- profiles_private, post_views and user_theme cascade from the profiles
-- delete.
CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Study data — study_messages / quiz_attempts / study_papers /
  -- chapter_overrides all cascade from learner_profiles.
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

  DELETE FROM public.orders WHERE user_id = me;

  DELETE FROM public.reports WHERE reporter_id = me;
  DELETE FROM public.profiles WHERE id = me;
  DELETE FROM auth.users WHERE id = me;
END;
$function$;


-- Revoke EXECUTE from anon/public on SECURITY DEFINER functions that require auth.uid()
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'complete_lesson(uuid,integer)',
    'place_order(uuid,jsonb,text)',
    'mark_conversation_read(uuid)',
    'toggle_moment_like(uuid)',
    'unread_count(uuid)',
    'find_or_create_direct_conversation(uuid)',
    'send_red_packet(text,numeric,text)',
    'reclaim_red_packet(uuid)',
    'mark_policy_notice_seen()',
    'is_admin(uuid)',
    'create_group(text,uuid[])',
    'add_group_members(uuid,uuid[])',
    'remove_group_member(uuid,uuid)',
    'leave_group(uuid)',
    'list_public_channels(text,integer)',
    'create_channel(text,text,boolean)',
    'join_channel(uuid)',
    'get_chat_list()',
    'send_friend_request(uuid)',
    'respond_friend_request(uuid,boolean)',
    'open_red_packet(uuid)',
    'set_primary_bank(uuid)',
    'admin_remove_content(text,text,text)',
    'demo_top_up(numeric)',
    'add_bank_account(text,text,text,text,text)',
    'withdraw_to_bank(uuid,numeric)',
    'send_payment(text,numeric,text)',
    'record_clip_view(uuid)',
    'toggle_clip_like(uuid)',
    'get_my_profile_private()',
    'create_payment_request(text,numeric,text)',
    'respond_payment_request(uuid,boolean)',
    'is_conversation_member(uuid,uuid)',
    'clips_feed(integer,integer)'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;

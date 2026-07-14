-- Fix privilege-escalation: any authenticated user could insert themselves
-- into conversation_members for ANY conversation_id, gaining read access to
-- private chats via the messages/conversations SELECT policies which are
-- gated on is_conversation_member.
--
-- All legitimate membership writes in the app go through SECURITY DEFINER
-- RPCs (find_or_create_direct_conversation, create_group, add_group_members,
-- join_channel, create_channel, leave_group, remove_group_member), which
-- bypass RLS and enforce their own authorization. There is NO legitimate
-- client-side direct INSERT into public.conversation_members.
--
-- Replace the permissive INSERT policy with a deny-all check so RLS blocks
-- any direct client insert, while the SECURITY DEFINER RPCs continue to
-- function unchanged.

DROP POLICY IF EXISTS conv_members_insert ON public.conversation_members;

CREATE POLICY conv_members_insert_denied
  ON public.conversation_members
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

COMMENT ON POLICY conv_members_insert_denied ON public.conversation_members IS
  'Direct client INSERT is denied. Membership is created only via SECURITY DEFINER RPCs (find_or_create_direct_conversation, create_group, add_group_members, join_channel) which authorize the caller and bypass RLS.';
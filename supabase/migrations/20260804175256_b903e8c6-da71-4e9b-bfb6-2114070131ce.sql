DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages
FOR SELECT TO authenticated
USING (
  is_conversation_member(conversation_id, auth.uid())
  AND (COALESCE(is_deleted, false) = false OR sender_id = auth.uid())
);
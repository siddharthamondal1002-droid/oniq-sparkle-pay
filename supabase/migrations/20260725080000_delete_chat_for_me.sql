-- Delete chat "for me": hide a conversation (and its prior history) from the
-- current user without touching the other participant's copy.

ALTER TABLE public.conversation_members
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz;

-- Direct chats: stamp cleared_at on my membership row — the chat disappears
-- from my list and history before that point stays hidden for me. If the peer
-- messages again, the chat reappears (empty) because there are newer messages.
-- Groups/channels: "delete" means leave (reuses leave_group's owner handover).
CREATE OR REPLACE FUNCTION public.delete_chat(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); ctype text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT c.type INTO ctype
  FROM conversations c
  JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = me
  WHERE c.id = _conversation_id;
  IF ctype IS NULL THEN RAISE EXCEPTION 'not a member of this conversation'; END IF;
  IF ctype = 'direct' THEN
    UPDATE conversation_members
    SET cleared_at = now(), last_read_at = now()
    WHERE conversation_id = _conversation_id AND user_id = me;
  ELSE
    PERFORM public.leave_group(_conversation_id);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_chat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_chat(uuid) TO authenticated;

-- get_chat_list: respect cleared_at — hide cleared conversations unless they
-- have messages newer than the clear point, and never surface pre-clear
-- content as the row preview / unread count.
CREATE OR REPLACE FUNCTION public.get_chat_list()
RETURNS TABLE (
  conversation_id uuid,
  title text,
  type text,
  avatar_url text,
  updated_at timestamptz,
  last_message text,
  last_type text,
  last_sender_id uuid,
  last_sender_name text,
  last_created_at timestamptz,
  unread int,
  peer_read_at timestamptz,
  peer_id uuid
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me_convs AS (
    SELECT cm.conversation_id, cm.last_read_at, cm.cleared_at
    FROM conversation_members cm
    WHERE cm.user_id = auth.uid()
  )
  SELECT
    c.id AS conversation_id,
    COALESCE(
      CASE WHEN c.type = 'direct' THEN peer_prof.display_name END,
      CASE WHEN c.type = 'direct' THEN peer_prof.username END,
      c.name,
      'Chat'
    ) AS title,
    c.type,
    COALESCE(CASE WHEN c.type='direct' THEN peer_prof.avatar_url END, c.avatar_url) AS avatar_url,
    COALESCE(last_msg.created_at, c.updated_at) AS updated_at,
    last_msg.content AS last_message,
    last_msg.type AS last_type,
    last_msg.sender_id AS last_sender_id,
    CASE
      WHEN c.type='group' AND last_msg.sender_id = auth.uid() THEN 'You'
      WHEN c.type='group' AND last_msg.sender_id IS NOT NULL THEN
        split_part(trim(COALESCE(sender_prof.display_name, sender_prof.username, '')), ' ', 1)
      ELSE NULL
    END AS last_sender_name,
    last_msg.created_at AS last_created_at,
    COALESCE((
      SELECT count(*)::int FROM messages m2
      WHERE m2.conversation_id = c.id
        AND m2.sender_id <> auth.uid()
        AND COALESCE(m2.is_deleted, false) = false
        AND m2.created_at > COALESCE(mc.last_read_at, 'epoch'::timestamptz)
        AND m2.created_at > COALESCE(mc.cleared_at, 'epoch'::timestamptz)
    ), 0) AS unread,
    peer_member.last_read_at AS peer_read_at,
    peer_member.user_id AS peer_id
  FROM me_convs mc
  JOIN conversations c ON c.id = mc.conversation_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.type, m.sender_id, m.created_at
    FROM messages m
    WHERE m.conversation_id = c.id
      AND COALESCE(m.is_deleted,false)=false
      AND m.created_at > COALESCE(mc.cleared_at, 'epoch'::timestamptz)
    ORDER BY m.created_at DESC
    LIMIT 1
  ) last_msg ON true
  LEFT JOIN LATERAL (
    SELECT cm2.user_id, cm2.last_read_at
    FROM conversation_members cm2
    WHERE cm2.conversation_id = c.id AND cm2.user_id <> auth.uid() AND c.type='direct'
    LIMIT 1
  ) peer_member ON true
  LEFT JOIN profiles peer_prof ON peer_prof.id = peer_member.user_id
  LEFT JOIN profiles sender_prof ON sender_prof.id = last_msg.sender_id
  WHERE mc.cleared_at IS NULL OR last_msg.created_at IS NOT NULL
  ORDER BY COALESCE(last_msg.created_at, c.updated_at) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_list() TO authenticated;

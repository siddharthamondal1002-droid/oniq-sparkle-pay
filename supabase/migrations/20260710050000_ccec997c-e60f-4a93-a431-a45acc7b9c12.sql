
-- ============= PART A: get_chat_list RPC =============
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
    SELECT cm.conversation_id, cm.last_read_at
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
    ), 0) AS unread,
    peer_member.last_read_at AS peer_read_at,
    peer_member.user_id AS peer_id
  FROM me_convs mc
  JOIN conversations c ON c.id = mc.conversation_id
  LEFT JOIN LATERAL (
    SELECT m.content, m.type, m.sender_id, m.created_at
    FROM messages m
    WHERE m.conversation_id = c.id AND COALESCE(m.is_deleted,false)=false
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
  ORDER BY COALESCE(last_msg.created_at, c.updated_at) DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.get_chat_list() TO authenticated;

-- ============= PART B: friendships =============
CREATE TABLE IF NOT EXISTS public.friendships (
  user_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.friendships TO authenticated;
GRANT ALL ON public.friendships TO service_role;

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friendships_select ON public.friendships;
CREATE POLICY friendships_select ON public.friendships FOR SELECT TO authenticated
  USING (auth.uid() IN (user_a, user_b));

DROP POLICY IF EXISTS friendships_delete ON public.friendships;
CREATE POLICY friendships_delete ON public.friendships FOR DELETE TO authenticated
  USING (auth.uid() IN (user_a, user_b));

-- Inserts/updates only via RPCs (SECURITY DEFINER); no direct insert/update policies.

CREATE OR REPLACE FUNCTION public.send_friend_request(_to uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); a uuid; b uuid; existing record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _to IS NULL OR _to = me THEN RAISE EXCEPTION 'invalid target'; END IF;
  IF me < _to THEN a := me; b := _to; ELSE a := _to; b := me; END IF;
  SELECT * INTO existing FROM friendships WHERE user_a = a AND user_b = b;
  IF existing.user_a IS NOT NULL THEN
    IF existing.status = 'accepted' THEN RAISE EXCEPTION 'already friends'; END IF;
    RAISE EXCEPTION 'request already pending';
  END IF;
  INSERT INTO friendships (user_a, user_b, status, requested_by)
  VALUES (a, b, 'pending', me);
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_friend_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_friend_request(_other uuid, _accept boolean)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); a uuid; b uuid; row record;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF me < _other THEN a := me; b := _other; ELSE a := _other; b := me; END IF;
  SELECT * INTO row FROM friendships WHERE user_a = a AND user_b = b FOR UPDATE;
  IF row.user_a IS NULL THEN RAISE EXCEPTION 'no request found'; END IF;
  IF row.status <> 'pending' THEN RAISE EXCEPTION 'already resolved'; END IF;
  IF row.requested_by = me THEN RAISE EXCEPTION 'cannot respond to your own request'; END IF;
  IF _accept THEN
    UPDATE friendships SET status='accepted', accepted_at=now() WHERE user_a=a AND user_b=b;
    RETURN 'accepted';
  ELSE
    DELETE FROM friendships WHERE user_a=a AND user_b=b;
    RETURN 'declined';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.respond_friend_request(uuid, boolean) TO authenticated;

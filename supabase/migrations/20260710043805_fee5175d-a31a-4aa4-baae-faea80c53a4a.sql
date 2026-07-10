
-- Channels: extend conversations
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

-- case-insensitive unique username
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key ON public.profiles (lower(username));

-- Allow authenticated users to SELECT public channels even without membership
DROP POLICY IF EXISTS conversations_public_channels_select ON public.conversations;
CREATE POLICY conversations_public_channels_select ON public.conversations
  FOR SELECT TO authenticated
  USING (type = 'channel' AND is_public = true);

-- Extend messages INSERT policy: in channels, only owner/admin members may post
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_member(conversation_id, auth.uid())
    AND (
      NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.type = 'channel')
      OR EXISTS (
        SELECT 1 FROM public.conversation_members m
        WHERE m.conversation_id = messages.conversation_id
          AND m.user_id = auth.uid()
          AND m.role IN ('owner','admin')
      )
    )
  );

-- create_channel RPC
CREATE OR REPLACE FUNCTION public.create_channel(_name text, _description text, _is_public boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); conv_id uuid; nm text := trim(coalesce(_name,''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(nm) < 1 OR length(nm) > 50 THEN RAISE EXCEPTION 'channel name must be 1-50 chars'; END IF;
  INSERT INTO conversations (type, name, description, is_public, created_by)
  VALUES ('channel', nm, NULLIF(trim(coalesce(_description,'')), ''), coalesce(_is_public, false), me)
  RETURNING id INTO conv_id;
  INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (conv_id, me, 'owner');
  RETURN conv_id;
END; $$;

-- join_channel RPC (self-join into a public channel)
CREATE OR REPLACE FUNCTION public.join_channel(_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE me uuid := auth.uid(); is_pub boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT (type = 'channel' AND is_public = true) INTO is_pub FROM conversations WHERE id = _conversation_id;
  IF is_pub IS NOT TRUE THEN RAISE EXCEPTION 'not a public channel'; END IF;
  INSERT INTO conversation_members (conversation_id, user_id, role)
  VALUES (_conversation_id, me, 'member')
  ON CONFLICT DO NOTHING;
END; $$;

-- list_public_channels: browse public channels I'm NOT in yet
CREATE OR REPLACE FUNCTION public.list_public_channels(_search text DEFAULT NULL, _limit int DEFAULT 30)
RETURNS TABLE(id uuid, name text, description text, subscriber_count int, created_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.name, c.description,
         (SELECT count(*)::int FROM conversation_members m WHERE m.conversation_id = c.id) AS subscriber_count,
         c.created_at
  FROM conversations c
  WHERE c.type = 'channel' AND c.is_public = true
    AND NOT EXISTS (SELECT 1 FROM conversation_members m2 WHERE m2.conversation_id = c.id AND m2.user_id = auth.uid())
    AND (_search IS NULL OR c.name ILIKE '%' || _search || '%' OR coalesce(c.description,'') ILIKE '%' || _search || '%')
  ORDER BY subscriber_count DESC, c.created_at DESC
  LIMIT LEAST(GREATEST(_limit, 1), 100);
$$;

GRANT EXECUTE ON FUNCTION public.create_channel(text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_channel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_channels(text, int) TO authenticated;

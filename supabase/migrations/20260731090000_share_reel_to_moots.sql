-- Share-to-moots: one server round trip, sender always auth.uid(),
-- clip visibility re-checked SERVER-SIDE per recipient, blocks honoured
-- both directions. Reuses find_or_create_direct_conversation.
CREATE OR REPLACE FUNCTION public.share_reel_to_moots(
  _clip_id uuid, _recipient_ids uuid[], _note text DEFAULT NULL
)
RETURNS TABLE(recipient_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  me uuid := auth.uid();
  clip record;
  r uuid;
  conv uuid;
  msg text;
  caller_sees boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _recipient_ids IS NULL OR array_length(_recipient_ids, 1) IS NULL THEN RETURN; END IF;
  IF array_length(_recipient_ids, 1) > 20 THEN RAISE EXCEPTION 'too many recipients'; END IF;

  SELECT c.id, c.user_id, c.visibility, c.is_deleted INTO clip
  FROM clips c WHERE c.id = _clip_id;

  caller_sees := clip.id IS NOT NULL AND NOT clip.is_deleted AND (
    clip.user_id = me
    OR clip.visibility = 'public'
    OR (clip.visibility = 'moots' AND EXISTS (
      SELECT 1 FROM friendships f WHERE f.status = 'accepted'
        AND ((f.user_a = me AND f.user_b = clip.user_id) OR (f.user_b = me AND f.user_a = clip.user_id))))
  );

  msg := CASE WHEN _note IS NOT NULL AND length(trim(_note)) > 0
              THEN left(trim(_note), 300) || E'\n' ELSE '' END
         || 'https://oniqhub.com/r/' || _clip_id::text;

  FOREACH r IN ARRAY _recipient_ids LOOP
    recipient_id := r;
    IF NOT caller_sees THEN status := 'unavailable';
    ELSIF r = me THEN status := 'skipped';
    ELSIF NOT EXISTS (
      SELECT 1 FROM friendships f WHERE f.status = 'accepted'
        AND ((f.user_a = me AND f.user_b = r) OR (f.user_b = me AND f.user_a = r))
    ) THEN status := 'not_moot';
    ELSIF EXISTS (
      SELECT 1 FROM blocked_users b
      WHERE (b.blocker_id = me AND b.blocked_id = r) OR (b.blocker_id = r AND b.blocked_id = me)
    ) THEN status := 'blocked';
    ELSIF clip.visibility = 'moots' AND r <> clip.user_id AND NOT EXISTS (
      -- a moots-only reel may only travel to the OWNER's moots
      SELECT 1 FROM friendships f WHERE f.status = 'accepted'
        AND ((f.user_a = r AND f.user_b = clip.user_id) OR (f.user_b = r AND f.user_a = clip.user_id))
    ) THEN status := 'no_access';
    ELSE
      conv := public.find_or_create_direct_conversation(r);
      INSERT INTO messages (conversation_id, sender_id, content, type)
      VALUES (conv, me, msg, 'text');
      UPDATE conversations SET updated_at = now() WHERE id = conv;
      status := 'sent';
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.share_reel_to_moots(uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.share_reel_to_moots(uuid, uuid[], text) TO authenticated;

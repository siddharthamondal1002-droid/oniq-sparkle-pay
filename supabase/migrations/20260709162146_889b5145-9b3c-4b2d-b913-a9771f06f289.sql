
-- Group chat RPCs: create/add/remove/leave with proper ownership + auth
CREATE OR REPLACE FUNCTION public.create_group(_name text, _member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); conv_id uuid; uid uuid; nm text := trim(coalesce(_name,''));
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(nm) < 1 OR length(nm) > 50 THEN RAISE EXCEPTION 'group name must be 1-50 chars'; END IF;
  IF _member_ids IS NULL OR array_length(_member_ids,1) IS NULL THEN RAISE EXCEPTION 'add at least one member'; END IF;
  IF array_length(_member_ids,1) > 100 THEN RAISE EXCEPTION 'too many members'; END IF;
  INSERT INTO conversations (type, name, created_by) VALUES ('group', nm, me) RETURNING id INTO conv_id;
  INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (conv_id, me, 'owner');
  FOREACH uid IN ARRAY _member_ids LOOP
    IF uid <> me THEN
      INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (conv_id, uid, 'member')
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN conv_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.create_group(text, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_group_members(_conversation_id uuid, _member_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); my_role text; uid uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT role INTO my_role FROM conversation_members WHERE conversation_id=_conversation_id AND user_id=me;
  IF my_role IS NULL THEN RAISE EXCEPTION 'not a member'; END IF;
  IF my_role <> 'owner' THEN RAISE EXCEPTION 'only the owner can add members'; END IF;
  FOREACH uid IN ARRAY _member_ids LOOP
    INSERT INTO conversation_members (conversation_id, user_id, role) VALUES (_conversation_id, uid, 'member')
    ON CONFLICT DO NOTHING;
  END LOOP;
END; $$;
GRANT EXECUTE ON FUNCTION public.add_group_members(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_group_member(_conversation_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); my_role text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT role INTO my_role FROM conversation_members WHERE conversation_id=_conversation_id AND user_id=me;
  IF my_role <> 'owner' THEN RAISE EXCEPTION 'only the owner can remove members'; END IF;
  IF _user_id = me THEN RAISE EXCEPTION 'owner cannot remove self — use leave_group'; END IF;
  DELETE FROM conversation_members WHERE conversation_id=_conversation_id AND user_id=_user_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.remove_group_member(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.leave_group(_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); my_role text; next_owner uuid; remaining int;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT role INTO my_role FROM conversation_members WHERE conversation_id=_conversation_id AND user_id=me;
  IF my_role IS NULL THEN RETURN; END IF;
  DELETE FROM conversation_members WHERE conversation_id=_conversation_id AND user_id=me;
  SELECT count(*) INTO remaining FROM conversation_members WHERE conversation_id=_conversation_id;
  IF remaining = 0 THEN
    DELETE FROM conversations WHERE id=_conversation_id;
    RETURN;
  END IF;
  IF my_role = 'owner' THEN
    SELECT user_id INTO next_owner FROM conversation_members
      WHERE conversation_id=_conversation_id ORDER BY joined_at ASC NULLS LAST LIMIT 1;
    IF next_owner IS NOT NULL THEN
      UPDATE conversation_members SET role='owner'
        WHERE conversation_id=_conversation_id AND user_id=next_owner;
    END IF;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION public.leave_group(uuid) TO authenticated;

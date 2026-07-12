
CREATE OR REPLACE FUNCTION public.toggle_message_star(_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  conv uuid;
  has boolean;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT conversation_id INTO conv FROM public.messages WHERE id = _message_id;
  IF conv IS NULL THEN RAISE EXCEPTION 'message not found'; END IF;
  IF NOT public.is_conversation_member(conv, me) THEN
    RAISE EXCEPTION 'not a member';
  END IF;
  SELECT me = ANY(starred_by) INTO has FROM public.messages WHERE id = _message_id;
  IF has THEN
    UPDATE public.messages SET starred_by = array_remove(starred_by, me) WHERE id = _message_id;
    RETURN false;
  ELSE
    UPDATE public.messages SET starred_by = array_append(starred_by, me) WHERE id = _message_id;
    RETURN true;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.toggle_message_star(uuid) TO authenticated;

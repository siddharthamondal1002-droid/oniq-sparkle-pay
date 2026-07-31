CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _uid IS NULL THEN false
    WHEN auth.uid() IS NULL OR _uid = auth.uid()
      THEN COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = _uid), false)
    WHEN COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()), false)
      THEN COALESCE((SELECT p.is_admin FROM public.profiles p WHERE p.id = _uid), false)
    ELSE false
  END
$function$;
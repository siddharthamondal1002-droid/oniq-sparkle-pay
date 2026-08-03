CREATE OR REPLACE FUNCTION public.export_my_data()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'exported_at', now(),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.id = auth.uid()),
    'private_profile', (SELECT to_jsonb(pp) FROM public.profiles_private pp WHERE pp.user_id = auth.uid()),
    'consents', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.recorded_at DESC)
                          FROM public.user_consents c WHERE c.user_id = auth.uid()), '[]'::jsonb),
    'consent_records', COALESCE((SELECT jsonb_agg(to_jsonb(cr) ORDER BY cr.seq)
                          FROM public.consent_records cr WHERE cr.user_id = auth.uid()), '[]'::jsonb),
    'dsr_requests', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at)
                          FROM public.dsr_requests d WHERE d.user_id = auth.uid()), '[]'::jsonb),
    -- learner_profiles has no unique constraint on user_id: multiple study
    -- profiles per user are an intended feature, so this must be aggregated.
    'learner_profiles', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at)
                          FROM public.learner_profiles l WHERE l.user_id = auth.uid()), '[]'::jsonb),
    'grievances', COALESCE((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.created_at DESC)
                            FROM public.grievances g WHERE g.user_id = auth.uid()), '[]'::jsonb)
  );
$function$;

-- The one ticket wedged by the multi-row defect. Kept as an audit record.
UPDATE public.dsr_requests
   SET status = 'rejected',
       cancelled_at = now(),
       updated_at = now(),
       details = COALESCE(details || ' ', '') ||
         'Export failed due to the export_my_data multi-row defect (SQLSTATE 21000); request superseded.'
 WHERE id = '92a1d033-e596-4c70-9762-06991452e8b1'
   AND request_type = 'portability'
   AND status = 'received'
   AND completed_at IS NULL;
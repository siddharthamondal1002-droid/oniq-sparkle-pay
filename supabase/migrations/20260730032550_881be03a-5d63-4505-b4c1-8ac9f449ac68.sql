ALTER FUNCTION public.incident_set_deadlines() SET search_path = public, pg_temp;
ALTER FUNCTION public.legal_request_guard() SET search_path = public, pg_temp;
ALTER FUNCTION public.takedown_set_sla() SET search_path = public, pg_temp;
ALTER FUNCTION audit.block_mutation() SET search_path = audit, public, pg_temp;
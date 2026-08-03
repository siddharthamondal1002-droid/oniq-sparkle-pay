GRANT EXECUTE ON FUNCTION public.verify_consent_chain(uuid) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO service_role, postgres;
REVOKE ALL ON FUNCTION public.verify_consent_chain(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_audit_chain() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_consent_chain(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain() TO authenticated;
GRANT EXECUTE ON FUNCTION public.breach_record_awareness(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.breach_notify_users(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.breach_notify_board(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.breach_submit_report(uuid, text) TO authenticated;
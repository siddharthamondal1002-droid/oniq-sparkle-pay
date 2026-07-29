CREATE SCHEMA IF NOT EXISTS audit;
GRANT USAGE ON SCHEMA audit TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS audit.moderation_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor uuid NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  reason text
);

ALTER TABLE audit.moderation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_admin_select ON audit.moderation_log;
CREATE POLICY audit_admin_select ON audit.moderation_log
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
GRANT SELECT ON audit.moderation_log TO authenticated;
GRANT ALL ON audit.moderation_log TO service_role;

CREATE OR REPLACE FUNCTION audit.log_moderation(
  _action text, _target_type text, _target_id text, _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = audit, public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  INSERT INTO audit.moderation_log (actor, action, target_type, target_id, reason)
  VALUES (auth.uid(), left(_action, 80), left(_target_type, 40), left(_target_id, 80), left(_reason, 500));
END;
$$;
REVOKE ALL ON FUNCTION audit.log_moderation(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION audit.log_moderation(text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION audit.block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit log is append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_no_update ON audit.moderation_log;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit.moderation_log
  FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
DROP TRIGGER IF EXISTS audit_no_delete ON audit.moderation_log;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit.moderation_log
  FOR EACH ROW EXECUTE FUNCTION audit.block_mutation();
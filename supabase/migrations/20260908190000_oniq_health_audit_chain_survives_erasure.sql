-- ONIQ Health — the audit chain survives an account's erasure.
--
-- FOUND 2026-09-08 by scripts/health-production-check.sql, minutes after the
-- throwaway account it had used was deleted: AUDIT_CHAIN_BROKEN at seq 4.
-- health_audit.user_id is `references auth.users(id) on delete set null`, and
-- health_audit_chain() hashes coalesce(new.user_id::text,'') into record_hash.
-- Deleting the auth user therefore REWRITES a hashed column of every audit row
-- that names them, and the recompute fails for each. Measured: seq 4 verifies
-- with its original id substituted back, and seq 5 still links to seq 4's
-- stored hash — the content changed and nothing else did. Real erasure does
-- exactly this (purgeUserData.ts step 4, auth.admin.deleteUser), so the first
-- person with health audit rows to delete their account would have broken the
-- chain for good. No such person exists yet: the feature is dark and the only
-- rows are six system and probe rows.
--
-- THE COMMITTED VALUE SURVIVES IN THE SAME ROW. Both writers — health-api's
-- audit() and health-ai's — pass actor = the person's own id, and `actor` is
-- text, not a foreign key, so the cascade leaves it alone. The verifier now
-- recovers the committed user slot as: user_id when present, else actor when
-- it is a UUID, else ''. Nothing is rewritten, no column is added, and nothing
-- is retained that was not already retained — `actor` carried the id before
-- this change and carries it after.
-- src/health/__tests__/auditChainSurvivesErasure.test.ts pins the invariant
-- the recovery rests on (every writer passes actor === userId), so a writer
-- that breaks it fails the build before it can write a row this verifier
-- cannot recover.
--
-- LIMITS, stated. A row whose user_id is nulled AND whose actor is not that
-- person's id (none can be written today) stays unverifiable after erasure;
-- the day such a writer is wanted, the chain needs a stored commitment (a
-- sha256 of the id) rather than the id itself — a column, not a verifier rule.
-- And nulling user_id by hand is now indistinguishable from erasure, which is
-- inherent: erasure IS nulling user_id, and actor still says who.
--
-- The function keeps its signature; only the slot expression changes.
-- scripts/health-production-check.sql carries the same expression, pinned
-- equal by productionCheck.test.ts. One tightening rides along: Phase 1
-- granted EXECUTE to authenticated and never revoked the default from PUBLIC,
-- so anon could call it (and be refused by the admin gate inside). Every other
-- health function revokes from public and anon; this one does now too.
--
-- APPLIED TO PRODUCTION 2026-09-08 18:45Z through the Lovable database
-- connection (query_database), the function, the revoke and the grant, each
-- its own statement; verified by reading pg_get_functiondef back (the fallback
-- and the admin gate present, SECURITY DEFINER, STABLE), the ACL (postgres,
-- authenticated, service_role), and by recomputing all six rows with this
-- expression: seq 4 — user_id nulled by the throwaway's deletion, actor still
-- its id — verifies again, and the chain is intact. Recorded in
-- supabase_migrations.schema_migrations under this version.
create or replace function public.health_verify_audit_chain()
returns table(ok boolean, rows_checked integer, first_bad uuid)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare r record; prev text := null; n integer := 0; bad uuid := null; calc text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;
  for r in select * from public.health_audit order by seq asc loop
    n := n + 1;
    calc := encode(extensions.digest(
      r.seq::text || '|' || r.id::text || '|' ||
      coalesce(r.user_id::text,
               case when r.actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then r.actor end,
               '') || '|' ||
      r.actor || '|' || r.action || '|' || r.object_type || '|' ||
      coalesce(r.object_id::text,'') || '|' || coalesce(r.purpose,'') || '|' ||
      coalesce(r.consent_id::text,'') || '|' || r.request_id::text || '|' || r.outcome || '|' ||
      r.detail::text || '|' ||
      to_char(r.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
      coalesce(prev,''), 'sha256'), 'hex');
    if calc <> r.record_hash or r.prev_hash is distinct from prev then
      bad := r.id; exit;
    end if;
    prev := r.record_hash;
  end loop;
  return query select bad is null, n, bad;
end $$;
revoke all on function public.health_verify_audit_chain() from public, anon;
grant execute on function public.health_verify_audit_chain() to authenticated;

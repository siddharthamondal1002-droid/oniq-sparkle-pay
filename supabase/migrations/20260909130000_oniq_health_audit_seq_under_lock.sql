-- ONIQ Health — the audit chain's seq is assigned under the chain lock, and a
-- row the old race orphaned can be adopted by a later chained row.
--
-- FOUND 2026-09-09 by scripts/health-production-check.sql, minutes after the
-- Phase 3b smoke test: AUDIT_CHAIN_BROKEN at seq 44 and seq 45 — the two
-- documents.register rows a throwaway account wrote when ONE SQL statement
-- queued two health-api calls through pg_net and they ran concurrently.
-- Measured, not reasoned: both rows' CONTENT hashes verify; only their LINKS
-- are crossed —
--
--     seq 44  prev_hash = record_hash of seq 45      (expected: seq 43's)
--     seq 45  prev_hash = record_hash of seq 43      (expected: seq 44's)
--     seq 46  prev_hash = record_hash of seq 45      (so 44 is referenced by
--                                                     NO row at all)
--
-- WHY. health_audit_chain() takes pg_advisory_xact_lock(7700000000000020)
-- before it reads the latest row and computes prev_hash — but `seq` came from
-- the column DEFAULT, nextval('health_audit_seq_seq'), which Postgres
-- evaluates BEFORE the BEFORE INSERT trigger runs, outside the lock. Two
-- transactions: A drew 44 and B drew 45; B took the lock first, saw 43 as the
-- latest, linked to it and committed; A then took the lock, saw 45 as the
-- latest (`order by seq desc`) and linked to THAT. The lock serialised the
-- hashing; the numbering had already happened in the other order.
--
-- THE CONSEQUENCE IS WORSE THAN A FALSE ALARM. Row 44 hangs off row 45 as a
-- branch nothing points back to: under the old trigger, deleting row 44
-- would have left the chain 43 -> 45 -> 46 -> … intact and nobody the wiser.
-- A tamper-evident log in which a concurrently written row can vanish
-- undetected is not tamper-evident for that row. Only appends made under a
-- race are affected; the three earlier pairs of concurrent calls in these
-- smoke tests (42/43, 46/47, 54/55) happened not to interleave.
--
-- THE FIX, forward: the trigger assigns `seq` ITSELF, inside the lock, from
-- the same read that supplies prev_hash — coalesce(latest.seq, 0) + 1 — so
-- the number and the link are decided together, in commit order. The
-- sequence default stays (it is harmless and keeps the column NOT NULL on
-- a direct insert); the trigger overrides it. A UNIQUE index on seq turns
-- any future numbering race into an error instead of a silent fork. The
-- hash expression is byte-for-byte unchanged, so every existing row keeps
-- verifying.
--
-- THE REPAIR, for the two rows already written — WITHOUT rewriting a hash.
-- Swapping their numbers would change their content hashes (seq is hashed);
-- re-linking them would change every hash after 43. Instead a later, chained
-- row ADOPTS the orphan by naming its record_hash: action 'chain.adopt',
-- object_type 'chain', detail {"adopts": ["<record_hash of seq 44>"], …}.
-- The verifier then treats an adopted row as content-verified (its own hash
-- must still recompute) but not link-verified, and skips it when linking the
-- rows around it — so 43 -> 45 -> 46 verifies, 44's content verifies, and 44
-- can no longer vanish: the adopting row commits to its hash, and an adopted
-- hash with no earlier row behind it is a violation. An adopt row may only
-- adopt rows with a SMALLER seq, and is itself an ordinary chained row.
-- 'chain.adopt' is written by an operator from SQL, never by an edge
-- function: the TypeScript action lists do not carry it, on purpose.
--
-- APPLIED TO PRODUCTION 2026-09-09 through the Lovable database connection
-- (query_database), one statement per call, then the adopt row for seq 44
-- through health_append_audit(null, 'system:chain-repair', 'chain.adopt',
-- 'chain', null, null, null, gen_random_uuid(), 'ok', '{"adopts":[…]}'),
-- then scripts/health-production-check.sql: zero rows. Recorded in
-- supabase_migrations.schema_migrations under this version.
-- src/health/__tests__/auditChainSeqUnderLock.test.ts pins the shape.

-- 1. The trigger: seq and prev_hash from one read, under the lock.
create or replace function public.health_audit_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare p text; last_seq bigint;
begin
  perform pg_advisory_xact_lock(7700000000000020);
  select seq, record_hash into last_seq, p from public.health_audit order by seq desc limit 1;
  new.seq := coalesce(last_seq, 0) + 1;
  new.created_at := now();
  new.prev_hash := p;
  new.record_hash := encode(extensions.digest(
    new.seq::text || '|' || new.id::text || '|' || coalesce(new.user_id::text,'') || '|' ||
    new.actor || '|' || new.action || '|' || new.object_type || '|' ||
    coalesce(new.object_id::text,'') || '|' || coalesce(new.purpose,'') || '|' ||
    coalesce(new.consent_id::text,'') || '|' || new.request_id::text || '|' || new.outcome || '|' ||
    new.detail::text || '|' ||
    to_char(new.created_at at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(p,''), 'sha256'), 'hex');
  return new;
end $$;

-- 2. Two rows can never share a number again.
create unique index if not exists health_audit_seq_key on public.health_audit (seq);

-- 3. The adopt action and its object type, by the named-constraint pattern.
alter table public.health_audit drop constraint if exists health_audit_action_check;
alter table public.health_audit add constraint health_audit_action_check check (action in (
  'records.create', 'records.delete', 'records.confirm', 'records.reject',
  'documents.register', 'documents.confirm', 'documents.read', 'documents.delete',
  'documents.classify', 'documents.extract',
  'consents.grant', 'consents.revoke',
  'ai.request', 'ai.refused',
  'export', 'purge',
  'config.ai_kill', 'config.ai_caps', 'config.changed',
  'chain.adopt'
));
alter table public.health_audit drop constraint if exists health_audit_object_type_check;
alter table public.health_audit add constraint health_audit_object_type_check check (object_type in (
  'record', 'document', 'consent', 'account', 'config', 'chain'
));

-- 4. The verifier: adopted rows are content-verified and skipped when linking;
--    an adopt row must be chained itself and may only adopt earlier rows.
--    The digest expression is the 2026-09-08 one (the actor fallback for an
--    erased account), unchanged.
create or replace function public.health_verify_audit_chain()
returns table(ok boolean, rows_checked integer, first_bad uuid)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare r record; prev text := null; n integer := 0; bad uuid := null; calc text; link text;
        adopted text[];
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;
  select coalesce(array_agg(x), '{}') into adopted
    from public.health_audit a, jsonb_array_elements_text(a.detail->'adopts') x
   where a.action = 'chain.adopt';
  for r in select * from public.health_audit order by seq asc loop
    n := n + 1;
    link := case when r.record_hash = any(adopted) then r.prev_hash else prev end;
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
      coalesce(link,''), 'sha256'), 'hex');
    if calc <> r.record_hash then
      bad := r.id; exit;
    end if;
    if r.record_hash = any(adopted) then
      continue;
    end if;
    if r.prev_hash is distinct from prev then
      bad := r.id; exit;
    end if;
    if r.action = 'chain.adopt' and exists (
      select 1 from jsonb_array_elements_text(r.detail->'adopts') x
      where not exists (select 1 from public.health_audit b where b.record_hash = x and b.seq < r.seq)
    ) then
      bad := r.id; exit;
    end if;
    prev := r.record_hash;
  end loop;
  return query select bad is null, n, bad;
end $$;
revoke all on function public.health_verify_audit_chain() from public, anon;
grant execute on function public.health_verify_audit_chain() to authenticated;

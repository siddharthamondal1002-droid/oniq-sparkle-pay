-- OQCA gets a durable home, and therefore its first caller in the app.
--
-- WHY THIS TABLE EXISTS. Every OQCA report since v1.5 names the same blocker in
-- the same words: "nothing persists, so nothing ages". The autonomy runtime can
-- observe, rank and reason, but `learned` comes back EMPTY on every run and the
-- whole maintenance path is unreachable, because the only durable store was a
-- file on a developer's disk written by scripts/oqca-self-improve.ts -- a file
-- no deployed function can see. That is also why the substrate, the runtime and
-- the self-improvement loop had no caller in the app at all.
--
-- IT IS TWO BLOBS, NOT A KNOWLEDGE SCHEMA, AND THAT IS DELIBERATE. The v1.7
-- store's own header says the sink may be "a file on a host, A COLUMN, a bucket
-- object", and the directive it was built to says: "Do NOT add a graph database
-- merely because this loop exists." `durable.ts` in the kernel already owns the
-- serialisation, the schema version and the row validation. Modelling knowledge
-- rows in Postgres as well would be a SECOND knowledge model that drifts from
-- the first -- exactly the three-places bug this repo hit today with the film
-- language list. So Postgres holds bytes and the kernel holds meaning.
--
-- NO CLIENT EVER TOUCHES IT. RLS is on with NO policy, so PostgREST shows an
-- authenticated caller nothing at all; the service role bypasses RLS and is the
-- only writer, exactly as `voice_clones` reasoned. The screen reads this through
-- the admin-gated `oqca-observe` function, never directly -- a client that could
-- write here could hand the loop any "knowledge" it liked.

create table if not exists public.oqca_state (
  -- 'knowledge' and 'checkpoint'. A closed set, because a typo'd key would
  -- silently give the runtime a fresh empty store and it would start from zero
  -- every morning with nothing anywhere saying so.
  key         text primary key check (key in ('knowledge', 'checkpoint')),
  -- The kernel's own JSON. Opaque here ON PURPOSE: see above.
  doc         text not null,
  updated_at  timestamptz not null default now()
);

alter table public.oqca_state enable row level security;

comment on table public.oqca_state is
  'OQCA durable sink: the kernel serialises, Postgres stores bytes. Service role only.';

-- Belt and braces next to the absent policy: even were a policy added by
-- accident, no client role holds a grant.
revoke all on public.oqca_state from anon, authenticated;
grant select, insert, update on public.oqca_state to service_role;

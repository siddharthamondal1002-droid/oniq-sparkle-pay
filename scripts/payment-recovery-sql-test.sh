#!/usr/bin/env bash
# Runs docs/payment-recovery/migration.sql against a THROWAWAY local PostgreSQL
# cluster and executes behavioural tests against it.
#
# NOTHING HERE TOUCHES A HOSTED PROJECT. Every psql invocation clears the
# managed PG* variables and connects over a unix socket inside this run's own
# directory, so a missing flag cannot silently reach production.
#
# ITS DIRECTORY AND ITS PORT ARE THIS RUN'S ALONE. The first version used a
# fixed /tmp path and began with `rm -rf` on it, so two runs — or a run beside
# anything else that had chosen the same name — deleted a live cluster's data
# directory out from under it. `mktemp -d` cannot collide, the cleanup removes
# only what this run created, and the port is derived from the PID.
#
# HOME IS NOT REPURPOSED EITHER. Pointing HOME at the data directory made
# psql/initdb write dotfiles into the thing under test; the server gets its own
# empty home inside the run directory.
#
# PostgreSQL refuses to run as root, and this container has no useradd, so the
# server runs as uid 1000 via setpriv.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(mktemp -d "${TMPDIR:-/tmp}/payrec-sql.XXXXXXXX")"
PORT=$(( 55000 + ($$ % 400) ))
PSQL=(env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE
      psql -X -v ON_ERROR_STOP=1 -h "$DIR/sock" -p "$PORT" -U test -d payrec)
AS_PG=(setpriv --reuid=1000 --regid=1000 --clear-groups --reset-env
       env HOME="$DIR/home" PATH=/bin:/usr/bin)

cleanup() {
  "${AS_PG[@]}" pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true
  # Only this run's own mktemp directory, and only if it still looks like one.
  case "$DIR" in */payrec-sql.*) rm -rf "$DIR" ;; esac
}
trap cleanup EXIT

mkdir -p "$DIR/data" "$DIR/sock" "$DIR/home" "$DIR/out"; chown -R 1000:1000 "$DIR"
"${AS_PG[@]}" initdb -D "$DIR/data" -U test -A trust -E UTF8 >"$DIR/init.log" 2>&1
"${AS_PG[@]}" pg_ctl -D "$DIR/data" -l "$DIR/server.log" \
  -o "-k $DIR/sock -p $PORT -c listen_addresses=" -w start >/dev/null
env -u PGHOST -u PGPORT -u PGUSER -u PGPASSWORD -u PGDATABASE \
  createdb -h "$DIR/sock" -p "$PORT" -U test payrec

echo "== loading fixtures and the reviewed SQL =="
"${PSQL[@]}" -q -f "$ROOT/docs/payment-recovery/test/prelude.sql"
"${PSQL[@]}" -q -f "$ROOT/docs/payment-recovery/migration.sql"

echo "== behavioural tests =="
"${PSQL[@]}" -f "$ROOT/docs/payment-recovery/test/tests.sql"

# ---------------------------------------------------------------------------
# CONCURRENCY, FROM REAL PARALLEL SESSIONS. A single-session test cannot see
# this: the select-then-insert shape passes every time when nothing runs beside
# it, which is exactly why it reaches production.
#
# Sessions synchronise on a wall-clock instant so their inserts collide, rather
# than queueing politely one after another.
# ---------------------------------------------------------------------------
echo "== concurrency: 12 sessions, one body =="
START=$(( $(date +%s) + 3 ))
for i in $(seq 1 12); do
  # EACH IN ITS OWN OPEN TRANSACTION, holding it past the call. Without that,
  # the first writer commits inside the microsecond spread and everyone else
  # merely READS the committed row — which a select-then-insert passes too, so
  # the test would be green against the shape it exists to catch.
  "${PSQL[@]}" -tA -v ON_ERROR_STOP=0 <<SQL >"$DIR/out/race.$i" 2>&1 &
    select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp())));
    begin;
    select public.payment_inbox_record('evt_race', repeat('9',64), 'payment.captured',
             'paid','order_race','pay_race',null,null, 1500,'captured', now())->>'outcome';
    select pg_sleep(2);
    commit;
SQL
done
wait
# `grep -c` over several files prints one count PER FILE, which reads as a
# failure on a healthy run. Concatenate first.
RECORDED=$(cat "$DIR"/out/race.* | grep -c '^recorded$' || true)
DUPES=$(cat "$DIR"/out/race.* | grep -c '^duplicate$' || true)
ROWS=$("${PSQL[@]}" -tAc "select count(*) from public.payment_webhook_events where body_sha256=repeat('9',64);")
ERRS=$(cat "$DIR"/out/race.* | grep -ci 'error' || true)
echo "   recorded=$RECORDED duplicate=$DUPES rows=$ROWS errors=$ERRS"
[ "$RECORDED" = "1" ] && [ "$DUPES" = "11" ] && [ "$ROWS" = "1" ] \
  || {
       # PRINT WHAT THE SESSIONS ACTUALLY SAID. A bare "not atomic" cannot
       # separate a dedup fault from a session that never connected, and the
       # first observed failure here was the second kind — `rows` was still 1.
       echo "FAIL: concurrent dedup is not atomic"
       echo "--- session output ---"
       cat "$DIR"/out/race.* | grep -i 'error\|fatal\|could not' | sort | uniq -c
       exit 1
     }
echo "   T11 ok  exactly one row survived twelve simultaneous deliveries"

echo "== concurrency: two claimers cannot hold one row =="
"${PSQL[@]}" -q -o /dev/null -c "
  select public.payment_inbox_record('evt_dlv_c'||g, md5(g::text)||md5((g+1)::text),
           'payment.captured','paid','order_c'||g,'pay_c'||g,null,null,100,'captured',now())
    from generate_series(1,20) g;"
START=$(( $(date +%s) + 3 ))
for i in 1 2 3 4; do
  "${PSQL[@]}" -tAc "
    select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp())));
    select string_agg(id::text, ',') from public.payment_inbox_claim(20, 120);
  " >"$DIR/out/claim.$i" 2>&1 &
done
wait
IDS=$(cat "$DIR"/out/claim.* | tr ',' '\n' | grep -E '^[0-9a-f-]{36}$' | sort)
TOTAL=$(echo "$IDS" | grep -c . || true)
DUP=$(echo "$IDS" | uniq -d | wc -l)
# TOTAL is half the assertion: with nothing claimed, "no duplicates" is true and
# says nothing.
echo "   claimed=$TOTAL duplicated=$DUP"
[ "$TOTAL" -ge 20 ] || { echo "FAIL: the claimers took $TOTAL rows; the test proved nothing"; exit 1; }
[ "$DUP" = "0" ] || { echo "FAIL: $DUP rows were claimed twice"; exit 1; }
echo "   T12 ok  no row was leased to two workers"

echo "== concurrency: one case, many events =="
START=$(( $(date +%s) + 3 ))
for i in $(seq 1 8); do
  "${PSQL[@]}" -tAc "
    select pg_sleep(greatest(0, $START - extract(epoch from clock_timestamp())));
    select public.payment_case_upsert('refund','rfnd_race','order_r','pay_r',
             'refund.created',1,2500)->>'outcome';
  " >"$DIR/out/case.$i" 2>&1 &
done
wait
OPENED=$(cat "$DIR"/out/case.* | grep -c '^opened$' || true)
CASES=$("${PSQL[@]}" -tAc "select count(*) from public.payment_cases where provider_case_id='rfnd_race';")
[ "$OPENED" = "1" ] && [ "$CASES" = "1" ] \
  || { echo "FAIL: opened=$OPENED cases=$CASES (a case was opened twice, or opened reported twice)"; exit 1; }
echo "   T13 ok  one case, opened exactly once, under eight simultaneous events"

echo
echo "ALL SQL TESTS PASSED (isolated cluster, port $PORT, discarded on exit)"

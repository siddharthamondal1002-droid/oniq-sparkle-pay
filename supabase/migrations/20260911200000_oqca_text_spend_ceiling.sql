-- OWNER DIRECTIVE, 2026-09-11: "increase the budget to 100$".
--
-- WHY THE NUMBER LANDS HERE AND NOT IN `Budgets.maxCostUsd`. That field is a
-- PER-RUN bound: `Spent` is constructed fresh by every `runCognitiveLoop` call,
-- so a hundred runs under a hundred-dollar run-bound spend ten thousand dollars
-- and nothing anywhere notices. What the owner asked for is a TOTAL, and a
-- total can only be held by something that outlives the run. This table already
-- is that, under row locks, for every other capability ONIQ spends on.
--
-- MEASURED BEFORE THE FIGURES WERE CHOSEN, with the shipped `estimateFor` over
-- the five real `ask` sites in `cognitiveLoop.ts` at their real output budgets:
--
--     worst single call                       $0.00075300
--     one run  (5 stations x 4 iterations)    $0.00804200
--     one tap  (3 episodes)                   $0.02412600
--     what $100 buys                          4,144 taps
--
-- So the three ceilings are arithmetic rather than taste:
--
--   request_usd_cap  0.01    13x the worst single call. One model call asking
--                            for more than a cent is pathological: the largest
--                            prompt the loop builds is IMAGINE's action list.
--   job_usd_cap      1.00    NOT USED BY OQCA — see below — but the table's
--                            `cap_ordering` CHECK requires request <= job <=
--                            daily, and this is the figure a future caller that
--                            DID pass a job id should get: 41x one tap.
--   daily_usd_cap  100.00    THE OWNER'S NUMBER. Cumulative, row-locked, shared
--                            by every TEXT caller admitted through the ledger.
--
-- OQCA PASSES NO JOB ID, AND THAT IS MEASURED RATHER THAN AN OMISSION.
-- `admit_provider_spend` increments `provider_spend_job.attempts` on EVERY
-- admission under a job id and refuses at `max_attempts_per_job`, which this
-- table's own CHECK caps at 10. One cognitive run makes TWENTY model calls, so
-- binding them to a single job would refuse call eleven with
-- `job-attempts-exhausted` and the loop would report it as a model with nothing
-- to say. The job ceiling is not the wrong SIZE, it is the wrong SHAPE: it
-- bounds a RETRY LADDER — one film regenerating one shot — and a cognitive run
-- is twenty distinct questions, not twenty attempts at one. `shadow.ts` carries
-- the same note at the call site, which is where someone would reintroduce it.
--
-- THE THREE CONTROLS AND WHAT EACH ONE IS FOR, because they are not
-- interchangeable and the whole point of this migration is that the owner's
-- number went to the one that can hold it:
--
--   Budgets.maxCostUsd   in code, per RUN    a runaway guard on one traversal
--   request_usd_cap      in Postgres, per CALL
--   daily_usd_cap        in Postgres, per DAY, CUMULATIVE  <- the owner's $100
--
-- NOTHING IS TURNED ON BY THIS ROW. `engine.ts` is the only caller in the
-- repository that names capability TEXT (`grep -rn 'capability: "TEXT"'`), and
-- it is not deployed at the time this is applied, so the row bounds a path that
-- does not yet run. Setting it first is deliberate: the ledger has to be able
-- to refuse before the thing it refuses exists.

insert into public.provider_budget_config
  (capability, daily_usd_cap, request_usd_cap, job_usd_cap, max_attempts_per_job, enabled)
values
  ('TEXT', 100.0000, 0.0100, 1.0000, 10, true)
on conflict (capability) do update
  set daily_usd_cap        = excluded.daily_usd_cap,
      request_usd_cap      = excluded.request_usd_cap,
      job_usd_cap          = excluded.job_usd_cap,
      max_attempts_per_job = excluded.max_attempts_per_job,
      enabled              = excluded.enabled,
      updated_at           = now();

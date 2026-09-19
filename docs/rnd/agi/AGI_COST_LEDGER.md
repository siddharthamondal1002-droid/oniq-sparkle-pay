# ONIQ AGI Cost Ledger

All currency is USD. Estimates and source-documented historical observations
are separated from costs reproduced in this sprint.

| ID | Activity | Estimate | Actual | External calls | Status |
|---|---|---:|---:|---:|---|
| B-001 | Commit-pinned repository inventory and review | 0.00 incremental model/provider spend | 0.00 observed incremental model/provider spend | 0 paid model/provider calls | Platform, CPU, network, storage, and labor unmetered |
| B-002 | Five-case grounding scorer reproduction | 0.00 incremental model/provider spend | 0.00 observed incremental model/provider spend | 0 | Other resource cost unmetered; not intelligence evidence |
| HIST-SCOUT-001 | Source-documented Opus-5 Scout request, six searches | 0.445625 reserved | 0.530683 documented actual | 1 request | Not reproduced; exceeded $0.50 reference by $0.030683 (6.14%) |
| OQCA-EST-001 | One 20-call cognitive run | 0.008042 source estimate | Not executed | 0 in this sprint | Per-run cap is 0.05 |
| OQCA-EST-002 | One three-episode tap | 0.024126 source estimate | Not executed | 0 in this sprint | Daily TEXT cap configured at 100.00 |
| E-003A | Deterministic repairs and sealed harness | 0.00 external | 0.00 observed external model/provider spend | 0 | Implemented on draft PR #174; 421/421 files and 7,390/7,390 tests passed; M163-M166 caught; unmetered platform/labor |
| E-003B | 576 core executions plus 300 agent-only safety executions (876 total) | Unknown | Not authorized/run | 0 | Requires frozen models and owner ceiling |

The OQCA estimates and ceilings come from
`supabase/functions/oqca-observe/index.ts` and migration
`20260911200000_oqca_text_spend_ceiling.sql`; they are source arithmetic, not a
settled bill. Workspace Agent trigger price, token use, and tool cost are unknown.

## Required Per-Call and Per-Run Fields

Record immutable run/task/arm IDs; actor and approval; model/provider/version;
prompt, tool, and evaluator hashes; input/cached/output tokens; retrieval/tool
units; CPU/GPU/storage/network where observable; estimates and reservations;
settled provider cost; latency; attempts/retries; failure; side effects; rollback;
and success. Report total spend and cost per successful task with variance reason.

## Proposed Controls

The target design admits before an external call. Budgets are durable, atomic,
non-rotatable by the caller, and scoped by capability and environment. Unknown
price means refuse, not zero. Ambiguous provider outcomes settle conservatively
and are not automatically retried. The agent cannot increase its own ceiling.

## E-003 Budget Gate

No dollar estimate is credible until the exact models, context/output bounds,
retrieval units, repeats, and provider price snapshot are frozen. The owner must
approve a hard aggregate and per-task ceiling after that preflight. A breach or
irreconcilable settlement invalidates the run and stops further calls.

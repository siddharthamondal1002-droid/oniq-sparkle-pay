-- GROUP CALLS ARE FREE, WITH NO PARTICIPANT CAP — owner directive, 2026-08-16.
--
-- This REPLACES 20260816100000_call_participant_cap.sql ("free 4, Plus 8"),
-- which had itself trimmed an earlier same-day "group calls stay free for
-- everyone" directive. The owner's decision, latest and in force: group
-- calling is free for every account and the room size is not a plan feature.
--
-- So the cap is removed from the schema rather than merely raised. A column
-- called max_call_participants that no longer caps anything is worse than no
-- column: it reads as authoritative, the client would keep asking, and the
-- next person to see it would reasonably assume a limit still applies.
--
-- WHAT THIS DOES NOT CLAIM. The call path is a MESH — every participant
-- uploads a separate copy of its camera to every other participant — so the
-- cost per phone still grows with the room:
--
--     4 people  ->  3 streams        8 people  ->  7 streams
--    12 people  -> 11 streams       20 people  -> 19 streams
--
-- Removing the cap does not remove that. The client's answer is to shrink the
-- per-stream bitrate as the room grows (src/lib/callCapacity.ts,
-- videoBitrateFor) so a large call gets softer instead of collapsing, and
-- nobody is ever refused a seat. Past roughly a dozen people the limit becomes
-- CPU — encoding N streams and decoding N more — which no bitrate maths fixes.
--
-- Genuinely unbounded rooms need an SFU: one upload per phone, server fans it
-- out. That is a paid media service and therefore an OWNER decision about
-- whose money it spends, in the shape CLAUDE.md reserves. It is written down
-- here so the option is visible, and it is NOT assumed or acted on.

-- The check first: it forbids anything outside 2..8, so it has to go before
-- the column can be dropped cleanly on any environment that still has it.
alter table public.subscription_plans
  drop constraint if exists subscription_plans_call_cap_sane;

-- Nothing reads this any more. The client no longer calls my_call_cap and no
-- longer selects the column; both are dropped in the same migration so there
-- is no window where one exists without the other.
drop function if exists public.my_call_cap(uuid);

alter table public.subscription_plans
  drop column if exists max_call_participants;

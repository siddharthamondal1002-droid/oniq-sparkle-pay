-- ============================================================================
-- HOW MANY PEOPLE ACTUALLY ARRIVED, not just how many were rung.
--
-- Asked 2026-08-17 after "group call is getting restricted to 4". The last
-- five group calls were read out of this table and could not answer it:
-- `callee_ids` records who was RUNG (8 of a 9-member group, every time — so
-- nothing truncates the invite list) and `duration_s` records how long the
-- call lasted, but nothing anywhere says how many of those eight ever
-- connected. Four working peers and eight working peers produce identical
-- rows.
--
-- That gap is the whole diagnosis. Three very different faults look the same
-- without it:
--
--   peers_connected = 0      signalling never completed. One such call was
--                            found in client_error_reports the same evening:
--                            "no peer reached connected in 20s (0 peer(s))".
--   peers_connected = 8,     everyone arrived and the call is fine; whatever
--   peers_peak = 8           the user saw is a rendering problem, not a mesh
--                            one.
--   peers_connected = 8,     people arrived and were pushed back out as
--   peers_peak = 4           others joined. THAT is a ceiling — bandwidth or
--                            hardware decoders — and it is the only one of
--                            the three that "restricted to 4" describes.
--
-- Two columns rather than one because the difference between them is the
-- entire signal. A running total alone cannot distinguish "eight joined and
-- stayed" from "eight joined and four survived".
--
-- Nullable, with no backfill: rows written before today genuinely do not know,
-- and inventing a number for them would poison the first query anyone runs.
-- ============================================================================
alter table public.call_logs
  add column if not exists peers_connected integer,
  add column if not exists peers_peak integer;

comment on column public.call_logs.peers_connected is
  'How many remote peers ever reached iceConnectionState connected/completed on the caller. NULL on rows written before 2026-08-17. callee_ids says who was RUNG; this says how many of them actually arrived, which is the difference between a signalling failure and a capacity one.';

comment on column public.call_logs.peers_peak is
  'The most peers connected at the SAME time. Below peers_connected means people were dropping as others joined — the signature of a ceiling rather than a refusal.';

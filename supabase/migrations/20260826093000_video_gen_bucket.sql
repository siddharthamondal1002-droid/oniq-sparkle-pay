-- The video-gen custody bucket, finally created.
--
-- runway.server.ts (2026-08) and gpuVideo.server.ts (2026-08-26) both store
-- finished clips under RUNWAY_BUCKET = 'video-gen' — but the bucket itself
-- was never made: the Runway tool has never run in production (video_jobs
-- had 0 rows when this landed), so nothing ever hit the missing bucket.
-- The in-house GPU tool WILL hit it on its first completed generation, and
-- a custody upload into a missing bucket fails the job (fail-closed, but a
-- guaranteed failure).
--
-- Private, and deliberately WITHOUT storage.objects policies: every write
-- and every signed playback URL is minted server-side with the service role
-- behind requireAdmin(), so authenticated clients need no storage access at
-- all — deny-by-default is the intended posture.

insert into storage.buckets (id, name, public)
values ('video-gen', 'video-gen', false)
on conflict (id) do nothing;

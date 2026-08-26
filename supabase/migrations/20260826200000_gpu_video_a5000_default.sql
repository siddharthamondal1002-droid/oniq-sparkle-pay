-- A5000 retarget (owner-settled 2026-08-26). The gpu_type column default
-- still named the launch card, and neither insert site set the column —
-- so every post-retarget row would have been stamped with a card it never
-- ran on. Inserts now record the card explicitly from the app's canonical
-- TARGET_GPU_ID (gpuVideoCore.ts); this default is aligned so a future
-- path that forgets the column still cannot stamp yesterday's card.
--
-- Existing rows are deliberately untouched: they really did run on the
-- 3090, and rewriting recorded history would falsify the ledger.
alter table public.gpu_video_jobs
  alter column gpu_type set default 'NVIDIA RTX A5000';

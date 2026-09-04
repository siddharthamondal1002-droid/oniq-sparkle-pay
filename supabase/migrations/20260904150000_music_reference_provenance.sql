-- Music reference provenance.
--
-- OWNER DIRECTIVE 2026-09-04c: a reference song is LISTENED TO and described,
-- and Lyria generates fresh from the description. The recording never reaches
-- Lyria. The screen has to make that visible rather than implying a transform,
-- so what was attached and what was heard are recorded on the row instead of
-- living only in a log the person cannot see.
--
-- Both columns are nullable and additive: every existing row is a text-only
-- song and stays exactly as it is.

alter table public.music_jobs
  add column if not exists reference text,
  add column if not exists brief text;

comment on column public.music_jobs.reference is
  'What was attached: ''image'' (sent straight to Lyria — measured 200) or ''audio'' (listened to by Gemini and described; the recording never reaches Lyria). Null for a text-only song.';
comment on column public.music_jobs.brief is
  'The one-line music brief derived from a reference track, shown back to the person so it is clear the reference produced a DESCRIPTION and not a copy. Null unless reference = ''audio''.';

-- Only these two values are ever written, and a typo would silently become a
-- third category the UI does not know how to show.
alter table public.music_jobs
  drop constraint if exists music_jobs_reference_check;
alter table public.music_jobs
  add constraint music_jobs_reference_check
  check (reference is null or reference in ('image', 'audio'));

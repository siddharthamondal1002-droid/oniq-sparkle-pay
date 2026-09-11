-- Punjabi joins the film languages.
--
-- The owner reported "Spoken in not working" and, asked which way, answered
-- "Punjabi isn't there". Their last three films were written in Gurmukhi and
-- recorded as language 'en', so the narration was English over a Punjabi story.
--
-- THE SET LIVES IN THREE PLACES, NOT TWO, AND THE DOCS SAID TWO.
-- storyLanguages.ts's header names itself and "the database CHECK
-- constraint". There is a third: claim_story_seconds carries its own
--
--     if lang_clean not in ('en','hi','bn','mr','ta','te')
--         then raise exception 'no such language'
--
-- and it runs FIRST. Widening only the CHECK would have shipped a Punjabi chip
-- that raised 'no such language' at the claim -- the film would never be
-- created and the studio would look like it did nothing, which is exactly the
-- symptom that started this. Found by reading the live function out of
-- pg_proc rather than trusting the doc comment. They agreed exactly before this change
-- (en, hi, bn, mr, ta, te -- verified against pg_constraint, not assumed) and
-- they must agree after it, or the UI offers a chip whose job the database
-- refuses and the film simply never appears. storyLanguages.test.ts is what
-- keeps them together.
--
-- WHY PUNJABI IS ALLOWED IN, per that file's own rule that the list may only
-- grow alongside evidence the voice speaks the language. story-voice sends no
-- language code -- it posts text and a voice name, and the model reads the
-- script it is handed -- so the only possible evidence is a POST. Measured
-- 2026-09-11 through the DEPLOYED story-voice with one Gurmukhi sentence:
-- HTTP 200, audio/wav, RIFF/WAVE PCM mono 24000 Hz 16-bit, 193,920 bytes of
-- data = 4.04 seconds. A refusal would have been a 502; a stub would have been
-- near-silent.
--
-- STILL UNPROVEN: nobody has listened to it. The gate is the owner hearing one
-- Punjabi film. Rollback is this constraint and one array entry.
--
-- Existing rows are untouched: 121 'en' and 4 'hi' at the time of writing, all
-- of which remain valid under the widened set.

alter table public.story_jobs drop constraint if exists story_jobs_language_check;

alter table public.story_jobs
  add constraint story_jobs_language_check
  check (language = any (array['en'::text, 'hi'::text, 'bn'::text, 'mr'::text, 'ta'::text, 'te'::text, 'pa'::text]));

-- The claim's own guard, widened by rewriting ONLY that list. The function is
-- long and every other line of it is a spend gate, so it is edited in place
-- from its own live definition rather than retyped: retyping is how a
-- money-handling function loses a line nobody notices. The assertion below is
-- load-bearing -- without it a missed match would leave the guard untouched
-- and this migration would silently do half its job.
do $mig$
declare
  def text;
  old_list constant text := $q$lang_clean not in ('en', 'hi', 'bn', 'mr', 'ta', 'te')$q$;
  new_list constant text := $q$lang_clean not in ('en', 'hi', 'bn', 'mr', 'ta', 'te', 'pa')$q$;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_story_seconds';

  if def is null then
    raise exception 'claim_story_seconds not found';
  end if;

  if position(new_list in def) > 0 then
    return; -- already widened; this migration is idempotent
  end if;

  if position(old_list in def) = 0 then
    raise exception 'claim_story_seconds language guard not in the expected shape; refusing to guess';
  end if;

  execute replace(def, old_list, new_list);
end
$mig$;

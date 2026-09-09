# ONIQ Health, as it now works

Owner directive, 2026-09-09: _"the system is very complicated make it simple"_.
Asked which complexity, they chose **the app's steps**. This is the whole
system in one page.

## What a person does

**Add a report.** Pick a file. That is the entire interaction. ONIQ stores it
privately, reads it, and the readings it states appear in the timeline, each
labelled AI-assisted, each deletable in one tap next to the document it came
from.

Before that used to take eleven steps: pick a type from a dropdown, type a
title, pick a file, wait, find Explain, tap it, read a note, scroll to a
suggestions card, tap "Add to timeline" three times, switch tabs.

**Everything else.** Type a reading in by hand. Ask a question about your
records. Summarise the timeline. Grant or revoke the two consents. Export
everything. Delete everything.

## What protects it

Five things, and nothing else needs to be understood to reason about safety:

| | |
|---|---|
| **Consent** | Nothing is stored without the storage consent; nothing reaches a model without the AI consent, which names Google Cloud Vertex AI. Revoking takes effect on the next request. |
| **Grounding** | A reading is stored only if the number is *printed on the page*. A sentence on a report cannot talk the reader into a value the report does not carry. |
| **Caps** | The house limit and each operation's per-person limit are checked and the receipt written in one locked transaction, so two requests at once cannot both slip through. Zero means unavailable, never unlimited. |
| **Kill switch** | One column. Every function obeys on its next request, with no deploy. |
| **Audit** | Every action appends to a hash chain that refuses edits and deletes by trigger, not just by permission. |

The output contract sits behind those: a model's answer is dropped if it states
a dose, diagnoses, impersonates a clinician, discourages care, or quotes a
number no cited record carries.

## What is deliberately not there

- **No confirm-each-value step.** The owner's call, made with the cost stated.
  The three things that replace it are grounding, the AI-assisted label, and
  one-tap delete — so a wrong value is visible and removable rather than
  invisible and trusted.
- **No invented physiological ranges.** A draft carried lower and upper bounds
  for thirty lab tests, written from memory. They were deleted. A guessed
  range silently discards exactly the extreme values that matter, and with no
  confirm step in front of the timeline that is the wrong direction to fail.
  What is left is arithmetic: printed or not, a date after tomorrow, the same
  value twice.
- **No Anthropic on the health path.** `health-scan` is a 410 stub; the
  registry holds two providers and neither is Anthropic.

## The pieces

```
src/health/                      client: flags, api, labels, i18n
src/routes/.../app.health*.tsx   four screens: timeline, reports, consent, admin
supabase/functions/health-api    records, documents, consents, export, purge
supabase/functions/health-ai     the one path to a model
supabase/functions/_shared/health/ai/
    gateway.ts    gate → consent → context → reserve → provider → contract → audit
    grounding.ts  is this value printed on the page?
    contract.ts   what an answer may not say
    vertex.ts     the one place a health byte leaves ONIQ
```

## Checking it

```
npx vitest run src/health                     the suite
scripts/health-production-check.sql           production, read-only; zero rows = pass
scripts/health-mutate-enforcement.sh          break each control, expect every test to catch it
scripts/health-mutate-guards.sh               break the isolation boundary, same
npx tsx scripts/health-bundle-markers.ts      is the shipped bundle the one we built?
scripts/health-ai-cost-report.sql             what was spent, per day and operation
```

## What a real device still owns

Nothing here has run on a phone. The file picker, the camera, and the signed
upload against the real bucket are proven only by the owner's own tap. The
server half has run live against production with throwaway accounts.

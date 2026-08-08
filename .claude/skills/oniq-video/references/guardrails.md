# Why each guard exists

Read this before weakening one. Each was put there for a reason that is not
obvious from the code alone, and most of them look like friction until the
day they don't.

## The cost order: admin → kill switch → daily cap → validation → billable call

The cap is checked **before** the Runway request, not after. Checking after
means you have already been charged for the call that broke the budget.

`runwayOps.server.ts` states the rest plainly:

> There is deliberately no batch input and no retry anywhere in this file.
> One submit, one clip. A loop over an array is how a month of credits
> disappears in an hour, and a failing prompt fails identically every time.

That second clause is the important half. Retry is normally good hygiene, and
it is wrong here: Runway failures are overwhelmingly _deterministic_ — a bad
prompt, a rejected ratio, an unreadable still. Retrying spends credits to get
the same error. If you add retry, gate it on transport errors only (timeout,
5xx) and never on a rejection Runway has already reasoned about.

`gen4_turbo` bills ~5 credits per second of output. A 5-second clip is ~25
credits. The daily cap is a **job count**, not a credit count, so raising
`duration` raises spend without touching the cap. If durations become variable,
the cap should move to credits.

The kill switch is a row in `video_gen_config`, not an env var, specifically so
it can be flipped mid-incident without a deploy.

## The admin gate is server-side, always

`app.admin.video.tsx` is unlinked from the app shell. That is cosmetic — anyone
can type a URL. Every server function calls `requireAdmin()`, which re-derives
the caller from their JWT and checks `is_admin` with the service role before
doing anything.

The rule to keep: **never let the presence or absence of a UI entry point be
the control.** If a new server function is added to this pipeline, it calls
`requireAdmin()` first, before reading the payload.

`RUNWAY_API_KEY` is read in `runway.server.ts` and nowhere else. Do not return
it, log it, or interpolate it into an error message — error strings get
surfaced to clients and pasted into issues.

## Bounded reads on uploads

Stills are checked by **content signature**, not extension: renaming
`payload.exe` to `frame.png` defeats an extension check completely, and an
extension check is worse than none because it looks like protection.

The read is a bounded slice — 12 bytes — because you cannot check a signature
without looking at the signature, and you must not materialise a media file to
do it. The same rule governs chat media (`src/lib/upload/chunkedUpload.ts`).

## AI labelling, and the hole that hid it

Play requires generative output to be **labelled** and **reportable from inside
the app**. An email address on a policy page does not satisfy it.

Lores shipped a season of generated video with neither. The guard that should
have caught it could not: the "none missed" test only inspected files that
_already rendered_ `<AiOutputReport />`, so it caught a stale declaration list
but was blind to the failure its own comment named — _shipped, unlabelled,
unreportable_. A surface with no label imports nothing to grep for.

The fix asks from the data side. `AI_CONTENT_MODULES` names modules whose
**content** is generated; any screen importing one must appear in
`AI_SURFACES`. Generated content has to come from somewhere, and the
somewheres are enumerable even when the renderers are not.

**So when you add generated media:** add its data module to
`AI_CONTENT_MODULES`, add the screen to `AI_SURFACES` with a distinct surface
id, add that id to the `AiSurface` union, and render the label plus the report
control. The test will tell you which of those you forgot.

Admin-only is not an exception. An internal screen inside the shipped app is
still a screen a reviewer can reach, and it is where the generation happens.

## Watch stays a directory

`watchDirectory.ts` records the decision at length. The short version: ONIQ
does not stream, embed, proxy or resolve third-party video, which takes
territorial licensing exposure to zero and removes the YouTube ToS question
entirely. Its tests assert the **absence of a player**.

Playing ONIQ's own originals does not touch that. The line is ownership, not
the `<video>` tag: content ONIQ made, fine; content someone else licensed,
never.

## Content rules in the shot list

Carried in `originals.ts`, for a season of Arabian Nights shipping to a largely
Muslim audience:

> no prophet, no divine figure, no scripture; the jar's seal is an unreadable
> mark, never attributed; jinn are folkloric wonder-beings with no theological
> framing; violence is implied and never depicted in any frame.

These live next to the scripts rather than in a policy document so that whoever
writes episode four reads them without going looking.

## Minors

A story hub is a children's surface. The loop guardrail is _no engagement
mechanics aimed at minors_ — the Study streak was deleted for exactly this. No
streaks, no autoplay-next, no "two more to unlock", no nagging notifications.

Separately, and worth a deliberate decision rather than discovering it at
review: presenting ONIQ as child-directed pulls it toward Play's **Families**
policy, which lands hard on an app already collecting Photos/videos, Messages
and health data.

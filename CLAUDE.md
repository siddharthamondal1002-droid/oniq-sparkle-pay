# ONIQ — working agreements

## Business decisions are the owner's — ask first

Owner directive, 2026-08-14. Recorded after the Story pipeline was routed
onto the metered Google AI key by an agent's engineering call (2026-08-09,
`4bb498e`) without the owner being asked — a provider-and-payment choice
presented as a code comment instead of a question.

**Before acting, ASK the owner about anything that:**

- chooses or changes a paid provider, API, or model tier, or which
  account's money a feature spends (Google key vs Lovable credits vs
  anything else);
- sets or changes prices, margins, caps, quotas, or what is on sale;
- spends real money beyond what an existing, owner-approved path already
  spends in the normal course of running;
- changes a user-visible policy (watermarks, refunds, content rules,
  payout terms).

Engineering inside decisions already made — how to implement, test,
harden, or fix what the owner has approved — stays delegated and does not
need a question. When unsure which side of the line something is on, it is
a business decision: ask. An owner decision, once given, is recorded next
to the code it governs as "owner directive" with the date, the way the
2026-08-13 movie-on/classic-off flip is.

## Owner directive, 2026-09-04 — the Google model mapping

The owner mapped each ONIQ feature to a Google model and answered the three
questions that mapping raised. Recorded in full, with the measured evidence,
in the header of `supabase/functions/_shared/modelRegistry.ts`. In short:

- Image, voice and text run on the **Lovable gateway** (credits). Music alone
  runs on the **metered Google key**, because the gateway carries no music
  model at all — measured, not assumed.
- **Gemini serves text, Claude catches it.** The 2026-08-14 "text runs
  Claude-first" is superseded. The failover was not deleted, it was reversed:
  `callText` in `llm.ts` is the entry point, and callers that need real search
  still go to Claude, because the gateway's chat endpoint carries no search
  tools and a search-less engine invents its sources.
- Prices in that mapping are recorded **as the owner gave them**. They are
  Google list prices; this container cannot reach Google's pricing pages, and
  a reseller gateway is not obliged to charge them.

**Verify a model id by POST before writing it into code.** Not by ListModels —
`llm.ts` carries the measured table where a listed model with the right method
advertised returned 404 on every real call for months, leaving the fallback it
served dead the whole time. A catalogue says what exists; only a POST says what
this key may call.

## Owner directive, 2026-09-05 — Firebase for four services

The owner mapped four ONIQ services onto Firebase and answered the two
questions that mapping raised.

    Firestore = messages and conversations
    FCM       = push notification
    Firebase Auth = identity
    Storage   = photos/videos/files

**Postgres stays the system of record.** Firebase takes those four and
nothing else. Wallets, payments, the video-time ledger and the other ~140
tables stay in Postgres with their RLS. **The 125 existing accounts are
remapped, not restarted** — nobody loses a balance, a chat or a creation.

MEASURED 2026-09-05, before any of it was planned, because the plan changes
completely depending on these:

- Production carries 125 users, 920 messages, 58 conversations, 410 storage
  objects over 8 buckets (2805 MB), 142 tables and **242 live RLS policies**.
  The DATA is small; the IDENTITY coupling is not — 684 `auth.uid()`
  references across the migrations, 131 `supabase.auth.` calls in `src`.
- `android/app/google-services.json` says project `oniq-309bd`, project
  number `948410240436`, and `storage_bucket:
oniq-309bd.firebasestorage.app` — so **Firebase Storage is already
  provisioned**. Only ONE client is registered, an ANDROID one
  (`com.oniqhub.app`); there is **no web app and no OAuth client**.
- FCM IS ALREADY DONE. `send-push` is FCM v1 on `FIREBASE_SERVICE_ACCOUNT`,
  project `oniq-309bd`, with 48 registered device tokens. One of the four
  needs no work at all.

**THE UID IS THE WHOLE MIGRATION, and it is solvable.** Supabase supports
Firebase as a third-party auth provider: the Supabase client is given an
`accessToken` function returning the Firebase ID token, and `auth.uid()`
then resolves to the Firebase `sub`. That would normally orphan every row,
because a Firebase uid is not the UUID the rows are keyed to — and 242
policies compare `auth.uid()` against `uuid` columns. But `importUsers()`
accepts a CALLER-SPECIFIED uid of up to 128 characters, and a Supabase UUID
is 36. So the 125 users are imported into Firebase **with their existing
Supabase UUID as the Firebase uid**, `auth.uid()` keeps returning the same
value, and no policy, column or row has to change. Every user also needs the
`role: 'authenticated'` custom claim, or Supabase rejects the token.

**ORDERING, and it is not the intuitive one.** Firestore security rules
authenticate on `request.auth.uid`, which only exists once Firebase Auth is
the identity. So Firestore-for-chat DEPENDS on the Auth switch; doing it
first would mean proxying every read through the service account, which
throws away the client listeners that are the reason to use Firestore at
all. The order is Storage → Auth → Firestore, not "identity last".

TWO THINGS ONLY THE OWNER CAN DO, both in consoles this container cannot
reach — nothing client-side ships until the first one exists:

1. Register a **Web app** in the Firebase console for `oniq-309bd`, which
   produces the web config (`apiKey`, `authDomain`, `appId`, …). The JS SDK
   cannot talk to Firestore, Auth or Storage without it.
2. Confirm **Firestore is provisioned** (Native mode, and which region).
   This could not be read from outside: the unauthenticated Firestore
   `documents` endpoint returns Google's generic HTML 404 for a project that
   certainly does not exist as readily as for `oniq-309bd`, so that probe
   proves nothing. Only the console or the service account can answer it.

Storage is unblocked ONLY IN ITS SERVER-SIDE FORM, and the distinction is
the architectural one this whole directive turns on. Firebase Storage rules
key on `request.auth.uid` exactly as Firestore's do, so CLIENT-side Firebase
Storage waits on Auth too. What needs neither is the service-account form:
an edge function holding `FIREBASE_SERVICE_ACCOUNT` puts bytes in the
bucket and hands back a signed URL — which is precisely the shape ONIQ
already uses for Supabase Storage today.

THE TENSION TO DECIDE WITH OPEN EYES, because it does not go away by
picking a default. Going client-side with Firebase rules means TWO
authorization systems — Firestore/Storage rules and 242 Postgres RLS
policies — that must agree forever, and they will drift the first time one
is edited alone. Going server-side keeps RLS as the single authority but
throws away the realtime listeners and offline cache that are the reason to
want Firestore at all. Preserving the UUID as the Firebase uid is what
makes the client-side option survivable: both systems then key on the same
value, so a rule and a policy can be read against each other.

## Linting

A task is not complete until `npm run lint:ci` passes. Never use
`git commit --no-verify`.

- `npm run lint:ci` — the blocking gate. Same command in CI, the pre-commit
  hook, and the PostToolUse hook. `npm run lint:ci -- <paths>` for one file
  (~2s, vs ~44s for all of `src`).
- `npm run lint` — the full advisory run. Carries ~512 deliberate warnings.
  Never run it with `--max-warnings 0`.
- `npm run format:check` / `npm run format` — formatting. ESLint does not
  report formatting; Prettier owns it.

Machine-readable output: `npx eslint --config eslint.ci.config.mjs --format json <paths>`.

**`react-hooks/rules-of-hooks` is a release blocker.** On 2026-08-04 three
violations of it reached production. `tsc` was clean, 275 tests were green, and
a signed-in walk of the live app found nothing — the app threw to the root
error boundary only once a personalisation suggestion appeared. Placing a hook
after an early `return` is a documented, systematic failure mode for
LLM-written components, and this codebase is written almost entirely by agents.
Every hook goes above every early return, always.

Never run a repo-wide `eslint --fix` and commit it. It would touch nearly every
file and make future diffs unreviewable, which is the primary quality control
here.

The pre-existing violation tail is frozen in `eslint-suppressions.json` and
`eslint-suppressions.ci.json`. Only new violations fail. Ratchet it down with
`--prune-suppressions`; never add to it to make a new violation go away.

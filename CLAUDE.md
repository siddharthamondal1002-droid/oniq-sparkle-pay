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

WHAT THE FULL SUPABASE PAGE CHANGED, once the owner supplied it — the search
excerpt had cut both:

- **The restrictive RLS policies are OPTIONAL for ONIQ.** Firebase signs every
  project's tokens with ONE shared key set, so a token from an unrelated
  Firebase project is cryptographically valid. On SELF-HOSTED Supabase that
  must be guarded with `as restrictive` policies on every table, bucket and
  channel; the HOSTED platform rejects unregistered project ids before they
  reach Postgres. That removes a policy pass over 142 tables — and makes one
  due the day ONIQ leaves hosted, so the reason lives in
  `supabase/config.toml` beside the switch rather than only here.
- **The vendor's own backfill sample is broken.** It calls
  `setCustomUserClaims(userRecord.id, ...)`, but firebase-admin's `UserRecord`
  exposes `uid`; `.id` is undefined, so all 125 calls would land in its catch
  having changed nothing. `scripts/firebase-import-users.mjs` sets the claim
  inline at import instead, so there is no second pass to get wrong.

PASSWORDS SURVIVE, which the remap answer needs to be true. Measured
2026-09-05: 86 of the 125 have a password and every stored hash begins
`$2a$` — bcrypt, which Firebase imports natively. Carrying the modular-crypt
string across means those 86 keep the password they already know; without it,
"keep every account" would still have meant 86 forced resets. The other 39
have no hash (provider or one-time-code sign-ins) and are imported without
one rather than with a guessed one.

WHO CAN CHANGE WHAT, MEASURED 2026-09-05 — because "Lovable has Supabase
admin access" is true and still not enough. The Lovable agent holds the
project's SERVICE ROLE: it runs SQL, deploys edge functions, and drives the
Auth _user_ admin API. It does NOT hold a management personal access token,
and third-party auth registration lives on the CONTROL plane. Asked to add
it, the agent tried every reachable path and got, verbatim:

    GET https://api.supabase.com/v1/projects/<ref>/config/auth
        Authorization: Bearer <service-role key>
    -> {"message":"JWT failed verification"}   HTTP 401

    GET <project>/auth/v1/admin/settings  (service role) -> 404 page not found

So: anything under `api.supabase.com` is the OWNER's to do, or needs a PAT
deliberately provisioned. A PAT is account-wide — it can delete projects —
so storing one as a project secret to save a dashboard visit is a bad trade
for a one-time setting. Recorded here so the next session does not spend a
round trip rediscovering that the service role is the wrong credential.

AND THE PROPAGATION QUESTION IS STILL OPEN. Whether the
`[auth.third_party.firebase]` block in `supabase/config.toml` reaches the
hosted project could NOT be answered: the public `/auth/v1/settings` endpoint
returns `external`, `saml_enabled` and `passkeys_enabled` but carries no
third-party field at all, so a Firebase registration would be invisible there
whether or not it exists. That is the same trap as the Firestore HTML 404 —
an endpoint that answers identically for "absent" and "not exposed" is not
evidence. It will be settled BEHAVIOURALLY instead: once a single Firebase
user exists, present its ID token to PostgREST. Accepted means registered;
rejected means not.

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

Both are answerable without a console visit, and the thing that answers them
is already live. `firebase-provisioning` is DEPLOYED on production — measured
2026-09-05, `POST /functions/v1/firebase-provisioning` answers 401 with no
JWT, the admin gate holding — so one tap on `/app/admin/firebase` asks Google
directly with the service account and prints whichever of the two is missing,
in Google's own words. That is faster and more certain than reading a console,
and it is the only credential that can answer at all.

The SCREEN is live too, which is a separate fact from the function being
deployed and from the code being on `main` — see `oniq-ship`. Verified against
the shipped bundle 2026-09-05: `admin/firebase` is in the served entry chunk
`assets/index-CdfOeNcr.js`, and the button's `firebase-provisioning-run`
marker is in its own route chunk `assets/app.admin.firebase-kO_onh2Z.js`.
Greping either one alone would have given a false verdict — the route path
appears only in the first, the marker only in the second.

Storage is unblocked ONLY IN ITS SERVER-SIDE FORM, and the distinction is
the architectural one this whole directive turns on. Firebase Storage rules
key on `request.auth.uid` exactly as Firestore's do, so CLIENT-side Firebase
Storage waits on Auth too. What needs neither is the service-account form:
an edge function holding `FIREBASE_SERVICE_ACCOUNT` puts bytes in the
bucket and hands back a signed URL — which is precisely the shape ONIQ
already uses for Supabase Storage today.

### Owner directive, 2026-09-05 (later the same day) — the SERVER route

**Decided: Lovable Cloud stays the identity, and the backend talks to Firebase
with the service account it already holds.** The phone presents its ordinary
Supabase session, the server re-derives who that is, and Firebase only ever
sees the service account. `src/lib/firebaseBridge.server.ts` is the only way
ONIQ speaks to Firestore or Firebase Storage; `supabase/functions/_shared/firebaseServer.ts`
holds the pure halves.

This SUPERSEDES the tension below rather than resolving it by argument — it is
decided, and the paragraph is kept because the cost it names is still being
paid. What the choice buys and costs:

- It needs **no Firebase web app, no Firebase Auth, and no user import** — all
  three of the things blocked in consoles this container cannot reach. The
  uid-preservation plan above is not wrong, it is DORMANT: it is exactly what
  a later identity switch would still need, so it stays recorded.
- **RLS stays the single authority.** Firebase is never asked to judge who may
  touch what, so there is no second authorization system to drift.
- **No realtime listeners and no offline cache**, because nothing client-side
  speaks to Firebase. That is precisely why **chat is NOT in this change** —
  a chat that has lost its live listeners is worse than the one ONIQ ships
  today. The Firestore-for-messages half of the mapping still waits on the
  identity switch.

THE GATE IS THE MIDDLEWARE, AND THE PREFIX IS THE BOUNDARY. `requireSupabaseAuth`
verifies the JWT and yields `claims.sub`; `BridgeRequest` has no user-id field,
so a caller cannot pass one. Every path is built server-side as
`users/{uid}/…`, and a caller only ever names a collection and a document.
Two properties were added 2026-09-05 after review, both mutation-tested:

- **The uid is validated, not merely interpolated.** It cannot hold a slash
  today because it is a verified UUID, but the builders are exported and the
  prefix is the whole boundary — the day one is called with an id from an edge
  function or an admin "act as", `../` would walk straight out.
- **A real filename survives the guard.** The first charset refused any space,
  so `Screenshot 2026-09-05 at 10.13.45.png` and `beach day.jpg` were rejected
  as "Bad file name". A guard nobody can upload through gets loosened by
  whoever hits it next, and they will not stop at the part that was merely
  inconvenient. The traversal rule is untouched; only the charset widened, and
  non-ASCII is still refused deliberately — arbitrary names want a generated id
  plus a display name in Firestore, not a bigger regex.

THE TENSION TO DECIDE WITH OPEN EYES, because it does not go away by
picking a default. Going client-side with Firebase rules means TWO
authorization systems — Firestore/Storage rules and 242 Postgres RLS
policies — that must agree forever, and they will drift the first time one
is edited alone. Going server-side keeps RLS as the single authority but
throws away the realtime listeners and offline cache that are the reason to
want Firestore at all. Preserving the UUID as the Firebase uid is what
makes the client-side option survivable: both systems then key on the same
value, so a rule and a policy can be read against each other.

## Two Supabase projects — only one of them is ONIQ

MEASURED 2026-09-05. `.mcp.json` wires the Supabase MCP server to project
`nzbthoecadcwdoqxhaok`, which `list_projects` names **"oniq-sparkle-pay"** —
the same string as this repository. **It is not the project this app talks
to.** Production is `bqwttemnnoexadpwifcj`, named in `supabase/config.toml`,
in `.env`, and in the Lovable MCP manifest's OAuth issuer.

The trap is expensive because the wrong answer looks like a right one. Asked
for the deployed edge functions, that MCP returned NINE. Probed directly, one
POST per function, production answered for all 63 in this repo and **not one
404** — including `send-push`, which the MCP's list omitted and which is
certainly live, since FCM v1 delivers to 48 registered device tokens through
it. A nine-item list reads exactly like "these are the ones deployed", so the
natural next move is to deploy the missing one into a project nothing will
ever call. It runs the other way too: SQL run there returns real rows from a
real database that simply is not ONIQ's.

**Do not repoint it.** Production is a Lovable Cloud project, so it lives in
Lovable's Supabase organisation rather than the owner's; `list_projects` on
the owner's own credential returns exactly one project and production is not
in it. The Lovable agent holds the only real service role, which is why every
deploy and every production query goes through it — see the `oniq-ship`
skill. `read_only=true` on the MCP URL is the second line of defence: it makes
a mix-up cost a round trip instead of a deploy.

`src/lib/__tests__/supabaseProjectRef.test.ts` pins all of this, and fails if
the MCP is ever given production so the fact gets updated deliberately.

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

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

## Owner directive, 2026-09-05 — cap story-plot, switch it to flash-lite

The owner read the September bill and gave two instructions for `story-plot`.
Both are recorded in full beside the code they govern —
`supabase/functions/story-plot/index.ts`, at `outputBudget` and at the spend
meter — and pinned by `src/lib/__tests__/storyPlotSpend.test.ts`.

WHAT THE BILL SAID, ₹346.21 for 1–30 September:

    gemini 3.6 flash text, output       399,078 count   ₹142.99   41.3%
    Gemini 3.1 Flash Image, output       16,800 count    ₹96.31
    Lyria 3 Music, 10 tracks + 2 clips       12 count    ₹84.08
    gemini 3.1 flash lite text, output    3,177 count     ₹0.46
    gemini 3.1 pro preview                                  absent

By category: text ₹150.35, image ₹111.26, music ₹84.08. Twenty-five SKU
rows, reconciling to the ₹346.21 total exactly.

Text was the largest line, not image and not music — and it ran on a model no
line of ONIQ names. `gemini-3.6-flash` is `GEMINI_FALLBACK_MODEL` in `llm.ts`,
what `callGemini` reaches for when a caller does not say. Only two callers did
not say: story-plot's two direct-Gemini branches and translate-message's
retry. **Both are pinned now** — the owner answered "fix it" on the second one
the same day, so no path in ONIQ reaches the fallback model any more.

**THE GUARD IS THE CALL SITE, NOT THE DEFAULT** —
`src/lib/__tests__/geminiModelPinned.test.ts` fails if any `callGemini(` in
`supabase/functions` omits `geminiModel`, or names a hand-typed id instead of a
registry constant. Changing `GEMINI_FALLBACK_MODEL` would NOT have prevented
this: the next caller to forget would simply land on whatever the new default
was, equally unchosen. A default is not a decision, and only the call site can
carry one. The fallback constant stays as `callGemini`'s internal default —
deleting it turns a forgotten model into a crash rather than an expensive
success, which is a different change and not this one.

What pinning translate-message gives up, stated rather than glossed: it used to
retry on a DIFFERENT model, which incidentally covered a model-specific outage
— llm.ts's measured 404 table records exactly that failure, a listed model
404ing on every real call for months. That cover was never worth much there,
because `callText`'s own primary is the same id: if flash-lite dies, Study, Ting
and story-plot die with it and a private retry rescues chat translation alone.
Model-outage cover belongs in `llm.ts`, not in one function's local retry.

That retry is also no longer a failover, and its log line was corrected to
match. It read "claude unavailable, trying gemini" — true when `callText` meant
Claude-first. Since the 2026-09-04b reversal `callText` tries Gemini DIRECT and
only catches with Claude, so reaching that line means BOTH engines already
refused. It is a third attempt, not a second opinion.

WHY THE TIER DID NOT SAVE IT, which is the part worth remembering. story-plot's
`opts` asked for `tier: "heavy"`, and the heavy id billed **zero tokens all
month**. A tier is a `callText` concept; `callGemini` never sees one. And with
no Claude key in production the `callText` path was never reached at all, so
every film fell through to the unpinned Gemini rescue. The tier was steering
nothing. Naming the id at the call site is what makes a model choice true.

**`maxTokens` CANNOT CAP A GEMINI CALLER — measured, not reasoned.**
`geminiOutputCeiling` floors at `GEMINI_MIN_OUTPUT_TOKENS` = 16384, so every
value story-plot passes sends Google the identical number:

    geminiOutputCeiling(300) = 16384      geminiOutputCeiling(4096) = 16384
    geminiOutputCeiling(1024) = 16384     geminiOutputCeiling(8192) = 16384

Lowering those ceilings would tighten Claude only; lowering the shared floor
would break `study-paper-generate`, which needs it. So the cap is a
per-REQUEST output-token meter instead — `outputBudget(shots)`, mirroring
`attemptBudget`'s shape — and it refuses rather than truncating, because a
truncated Gemini reply comes back EMPTY and is spent twice over as "bad JSON".
What runs away here is the chain, not the call: a 90-shot film may make 28
calls that Google would each allow 16,384 output tokens.

`tokensSpent` now travels back on both the 200 and the 502. The bill is a
monthly total with no per-request breakdown, so that is the only place the
cost of one film is knowable.

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

### Owner directive, 2026-09-05 (later still) — phone OTP on Firebase, and Firebase BECOMES the identity

The owner was asked which shape a Firebase phone-OTP switch should take and
chose **Firebase as the identity**, not Firebase as SMS delivery. That
SUPERSEDES the SERVER-route directive above on the identity question: its
"needs no Firebase web app, no Firebase Auth, and no user import" no longer
holds, and the uid-preservation plan recorded further up is **no longer
dormant — it is the plan**. The server-route bridge for Storage/Firestore is
untouched; only who issues identity changes.

Google's SMS pricing was accepted **as given**, the way the model prices were:
Firebase Phone Auth bills per message per destination country on the Blaze
plan, this container cannot reach Google's pricing pages, and the owner chose
to proceed without a MSG91 comparison. It is not established that this is
cheaper than what it replaces.

**THE SEND CANNOT BE DONE SERVER-SIDE, and that reshapes the work.** The
service account has no send-verification-code API; the real call is
`identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=<WEB_API_KEY>`
and it needs two things no server can supply — a Web API key, and a
reCAPTCHA/Play-Integrity attestation minted in the browser or by the
Play-signed app. So `send-otp` is not rewritten onto Firebase; its send half
goes away and the client does it. `send-otp` stays live and guarded until
then (see its own header).

**MEASURED 2026-09-05, and it is the unambiguous kind.** Asked with the
service account:

    GET https://firebase.googleapis.com/v1beta1/projects/oniq-309bd/webApps
    -> HTTP 200   {}

A 200 with an empty body is a successful list that is empty — **zero Firebase
Web apps** — not the Firestore HTML-404 trap where "absent" and "not exposed"
answer identically. The blocker is real and uncleared. `google-services.json`
agrees: one Android client (`com.oniqhub.app`), `oauth: NONE`.

**THE TWO BLOCKERS SERIALISE — they cannot be worked in parallel.** Settling
whether `[auth.third_party.firebase]` in `supabase/config.toml` actually
reaches the hosted project was to be answered BEHAVIOURALLY, by presenting a
Firebase ID token to PostgREST. Minting an ID token needs
`accounts:signInWithCustomToken?key=<WEB_API_KEY>` — the Web API key, which
comes from the Web app that does not exist. So blocker 2 is downstream of
blocker 1, and nothing further can be established until a Web app is
registered. Asked directly, the Lovable agent said it does not know whether
its deploy tooling applies that config block, and declined to infer it from
the file's presence — which is the right answer, not a gap to paper over.

**THE PLAN OF RECORD HAS NO SIGNUP STORY, and this is the load-bearing find.**
`scripts/firebase-import-users.mjs` covers the 125 EXISTING accounts and
carries `phoneNumber` across (line 84), so an existing user signing in by
phone resolves to their preserved UUID uid — that half is sound. But a person
with NO account who signs in by phone gets a Firebase-minted **native 28-char
uid**, and the script's own header states the consequence exactly: `auth.uid()`
casts the `sub` claim to `uuid`, so a native uid "would not merely fail to
match rows — it would fail to cast, and every policy on every table would
error." Signup is precisely what a phone-OTP switch is for, so this is a
total-failure hole in the direction just chosen, not a rough edge.

The shape that closes it, NOT YET BUILT because building against an untested
flow is what this file keeps warning against: the phone sign-in must not be
the account-creating step. A server endpoint takes the phone first,
`createUser({ uid: <a fresh UUID>, phoneNumber, customClaims: { role:
'authenticated' } })`, and only then does the client call
`signInWithPhoneNumber` — which now RESOLVES to that account instead of
minting one, so the token's `sub` is a UUID and the invariant holds for new
users as it does for imported ones. That endpoint is also the natural home for
the abuse controls `send-otp` just got, since it is what will be
unauthenticated and spending money next.

**THE WEB APP IS REGISTERED — and it was not the last blocker.** The owner
created it the same day; the config came back with `appId`
`1:948410240436:web:b6eb8391ad7135e7b676e1`, `authDomain
oniq-309bd.firebaseapp.com`, and a Web API key. (That key is PUBLIC by design
— Firebase ships it in every browser bundle — so it belongs in client config
next to the Supabase publishable key, not in the secret store.)

**FIREBASE AUTHENTICATION IS NOT TURNED ON, measured immediately after.** With
the Web app in place, the behavioural test was run: create one throwaway user
with a UUID uid, mint a custom token, exchange it for an ID token, present that
to PostgREST. It failed at the first step, in Google's own words:

    POST identitytoolkit.googleapis.com/v1/projects/oniq-309bd/accounts
    -> HTTP 400  {"error":{"code":400,"message":"CONFIGURATION_NOT_FOUND"}}

    POST identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken
    -> HTTP 400  {"error":{"code":400,"message":"CONFIGURATION_NOT_FOUND"}}

Registering a Web app produces CONFIG; it does not provision the Auth PRODUCT.
`CONFIGURATION_NOT_FOUND` is what Identity Toolkit returns for a project that
has no Auth configuration at all — which is the state before someone opens
Firebase console -> Build -> Authentication -> Get started. (The other thing
that produces it is the Identity Toolkit API being disabled in the GCP project;
enabling Auth normally enables it too, so check that second.) The service
account is fine and the project id is right — `webApps` answered 200 on the
same credential minutes earlier.

**AUTHENTICATION IS NOW PROVISIONED — measured 2026-09-05, and measured
WITHOUT the service account.** Identity Toolkit is reachable from this
container (unlike `*.supabase.co`), and `createAuthUri` needs only the public
Web API key, so the check no longer depends on the Lovable agent:

    POST identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=<WEB_KEY>
         {"identifier":"probe@example.com","continueUri":"http://localhost"}
    -> HTTP 200  {"kind":"identitytoolkit#CreateAuthUriResponse","sessionId":"..."}

A 200 there is only possible once the Auth config exists; the same call
answered `CONFIGURATION_NOT_FOUND` an hour earlier. **That is the API-key-only
probe to reach for first in future** — it is free, read-only, needs no
credential ONIQ has to protect, and it distinguishes provisioned from not.

**BUT NO SMS CAN BE SENT YET, and it is not India-specific.** Same key,
`accounts:sendVerificationCode`, three countries, no reCAPTCHA token:

    +91  India  -> 400 OPERATION_NOT_ALLOWED : SMS unable to be sent until
                       this region enabled by the app developer.
    +1   US     -> 400 (identical message)
    +44  UK     -> 400 (identical message)

Identical for every region tested, so this is default-deny rather than a rule
about India. Two candidates, both on the Authentication screen and NOT
distinguishable from outside — the API-key-readable `getProjectConfig` returns
`signIn.phone: null` on modern projects, so it cannot say which:

1. **SMS region policy** (Authentication -> Settings) starts allowing nothing
   and every region must be opted in. The error text is that feature's own
   wording, which makes it the likelier of the two.
2. The **Phone provider toggle** itself never got saved.

Check both; they are adjacent. This matters more for ONIQ than for most apps —
every phone path in the codebase is India-first (`normalizeIndian` refuses
anything but `+91`), so a region policy that omits India is a total outage of
sign-in, not a degradation.

**AND `oniqhub.com` IS NOT AN AUTHORIZED DOMAIN — measured, same probe:**

    getProjectConfig -> authorizedDomains:
        ['localhost', 'oniq-309bd.firebaseapp.com', 'oniq-309bd.web.app']

Web phone auth runs reCAPTCHA, and reCAPTCHA refuses on any domain not in that
list. ONIQ serves from `oniqhub.com`, which is absent, so the flow would fail
in production while working perfectly in local development — the worst shape of
bug to find late. Authentication -> Settings -> Authorized domains -> add it.

**SMS AND THE PHONE PROVIDER ARE NOW LIVE — measured by the error CHANGING.**
After the owner fixed the console settings, the same API-key-only call moved on:

    accounts:sendVerificationCode, +91 and +1, no reCAPTCHA token
    was -> 400 OPERATION_NOT_ALLOWED : SMS unable to be sent until this
                region enabled by the app developer
    now -> 400 MISSING_CLIENT_IDENTIFIER

`MISSING_CLIENT_IDENTIFIER` is Google asking for the app verifier — the
attestation step, which a server cannot pass and is not meant to. Reaching it
means the region check AND the provider check both passed. **An advancing error
is the signal here; a still-failing call is not the same as an unchanged one,
and reading only the status code would have missed it.**

**THE PROPAGATION QUESTION IS ANSWERED. FIREBASE IS _NOT_ REGISTERED.** Settled
behaviourally 2026-09-05 exactly as this file planned, with the three-way
control the earlier attempt lacked:

    Firebase ID token, correctly shaped:
      sub = <a generated UUID>   aud = oniq-309bd
      iss = https://securetoken.google.com/oniq-309bd   role = authenticated

    GET /rest/v1/chapters?select=*&limit=1
      apikey + Firebase idToken  -> 401 PGRST301
                                    "No suitable key was found to decode the JWT"
      apikey + "Bearer notatoken"-> 401 "Expected 3 parts in JWT; got 1"
      apikey only                -> 200 []

Three DISTINCT outcomes, which is what makes it evidence: the token was
well-formed (so not the control's failure) and reached the JWT check (so not
the baseline's path), and PostgREST refused it on the KEYSET. So
`[auth.third_party.firebase]` in `supabase/config.toml` is **inert on the
hosted project** — the file declares it, nothing applies it. Registration lives
on the Supabase CONTROL plane, which the service role cannot touch
(`api.supabase.com` -> `JWT failed verification`), so it is the OWNER's to add
or needs a deliberately provisioned PAT. **This is now the single blocker for
the whole identity switch.**

**`oniqhub.com` IS STILL NOT AN AUTHORIZED DOMAIN** — re-checked after the
owner's console pass, `getProjectConfig` still returns only `['localhost',
'oniq-309bd.firebaseapp.com', 'oniq-309bd.web.app']`. Web phone auth runs
reCAPTCHA, which refuses unlisted domains, so sign-in would work in local
development and fail in production.

**AND EMAIL/PASSWORD SELF-SIGNUP IS OPEN TO ANYONE HOLDING THE PUBLIC KEY** —
found while looking for a way to mint an ID token without the service account:

    POST accounts:signUp?key=<WEB_KEY>  {"email":..,"password":..}
    -> 200, account created, idToken returned
    POST accounts:signUp?key=<WEB_KEY>  {"returnSecureToken":true}  (anonymous)
    -> 400 ADMIN_ONLY_OPERATION

Anonymous is correctly locked; Email/Password is not. The web key ships in
every browser bundle, so that is unbounded account creation in the project
about to become ONIQ's identity. It buys an attacker nothing TODAY (Supabase
rejects the tokens, per above) and even after registration a self-signed-up
account carries a native 28-char uid that fails the `::uuid` cast — but it is
almost certainly unintended, since the console pass was only meant to turn on
Phone. Turn Email/Password off unless something needs it.

**SO THE ORDER IS SIX, AND ONE REMAINS:** Web app (DONE) -> enable
Authentication (DONE) -> SMS region + Phone provider (DONE) -> add
`oniqhub.com` to authorized domains (OWNER, outstanding) -> turn off
Email/Password unless wanted (OWNER, outstanding) -> **register Firebase as a
third-party auth provider on the Supabase control plane** (OWNER, and now the
only thing standing between here and a working identity switch).

**HOW TO CHECK ALL OF THIS WITHOUT ANY CREDENTIAL ONIQ MUST PROTECT.** The web
API key alone answers most of it, and `identitytoolkit.googleapis.com` is
reachable from the dev container even though `*.supabase.co` is not:

    accounts:createAuthUri       -> is Auth provisioned at all
    accounts:sendVerificationCode-> region policy + phone provider, by which
                                    error comes back (no SMS is ever sent,
                                    the attestation check fails first)
    relyingparty/getProjectConfig-> authorizedDomains
    accounts:signUp              -> which signup providers are open

Only the last question — does Supabase accept the token — needs the service
account, because minting an ID token needs a custom token and an API key
cannot sign one.

**AND ONE NON-RESULT, recorded so nobody reads it as a result.** The control
arm of that experiment — the same PostgREST call with `Bearer notatoken` —
returned `401 {"message":"Invalid API key"}`. That is PostgREST rejecting the
`apikey` header, not the bearer token, so the control never exercised what it
was meant to. Whatever publishable key the run picked up was not accepted at
`/rest/v1`. Before re-running the experiment, get a known-good `apikey` +
`Authorization` pair returning 200 FIRST, so that "rejected" can be
distinguished from "never reached the check".

### Owner directive, 2026-09-05 (final) — PHONE OTP ONLY. Supabase stays the identity.

**This SUPERSEDES the "Firebase BECOMES the identity" directive above.** The
owner's words, once the mismatch surfaced: _"I was having Google authentication
and everything was working fine. I added firebase for mobile number
authentication only."_

HOW THE MISUNDERSTANDING HAPPENED, recorded because the shape of it will recur.
The owner was offered two shapes and picked "Firebase becomes the identity" —
but described the other one. What made the mismatch visible was the owner
noticing an agent claim that Google sign-in might not work, and objecting. The
claim was wrong twice over:

- **ONIQ's Google sign-in has never been Firebase.** `src/routes/auth.tsx:531`
  calls `lovable.auth.signInWithOAuth("google", …)` — Lovable Cloud, i.e.
  Supabase Auth. The "39 of 125 with no password hash" measured earlier ARE
  those users. The "Google — Enabled" row in the FIREBASE console is a separate,
  unused provider toggled on during a console pass, and reading it as ONIQ's
  Google login was the error.
- It was argued from `android/app/google-services.json` showing `oauth: NONE`.
  That file was last committed 2026-08-22 — a snapshot, not live state. **A
  checked-in config file is a catalogue, and this file already says a catalogue
  is not a POST.** The same lesson, made the same evening, by the agent writing
  it down.

WHAT THE CORRECTED DIRECTIVE COSTS AND SAVES. Firebase sends the SMS and proves
possession of the phone; that is all it does. The client runs
`signInWithPhoneNumber`, gets a Firebase ID token, and hands it to an edge
function which verifies it with the service account ONIQ already holds, reads
the verified `phone_number` claim, and mints an ordinary **Supabase** session.
The same shape `msg91-verify-session` already uses.

- **Google sign-in is untouched.** So are the 125 accounts and all 242 RLS
  policies.
- **THE UID PROBLEM DISAPPEARS ENTIRELY**, and this is the load-bearing
  consequence. The Firebase uid never reaches Postgres — only the phone number
  crosses, and the session minted is a Supabase one keyed to a Supabase UUID.
  So `auth.uid()` keeps returning what it always did. The signup hole recorded
  above (a native 28-char uid failing the `::uuid` cast on every policy) is
  **moot under this directive**; it was a consequence of the identity switch,
  not of phone OTP.
- **The uid-preservation plan and `scripts/firebase-import-users.mjs` go back to
  DORMANT.** Both stay recorded, correct, and unused. They are what a future
  identity switch would still need.
- **NO SUPABASE THIRD-PARTY AUTH REGISTRATION IS NEEDED.** The blocker measured
  tonight — PostgREST answering `PGRST301 "No suitable key was found to decode
the JWT"` to a valid Firebase token — is real and stays true, and is now
  simply IRRELEVANT: no Firebase token is ever presented to PostgREST. The
  registration was a requirement of the abandoned shape only.
- What is given up: nothing client-side speaks to Firebase for data, so there
  are still no realtime listeners and no offline cache. That was already the
  standing position under the SERVER-route directive, which this restores.

NONE OF THE CONSOLE WORK WAS WASTED. The Web app, Authentication being
provisioned, the SMS region policy, the Phone provider and `oniqhub.com` as an
authorized domain are all required by phone OTP itself, and all are DONE and
measured. What is no longer required is the one thing that was still blocked.

WHAT IS LEFT TO BUILD, and it is small:

1. Client: Firebase JS SDK + `signInWithPhoneNumber` with reCAPTCHA, using
   `src/integrations/firebase/config.ts`. Adding the `firebase` dependency is
   Lovable's to do — it owns `package.json`.
2. Server: one edge function that takes the Firebase ID token, verifies it
   against Google's public keys for project `oniq-309bd`, and exchanges the
   verified phone for a Supabase session. Verify the token properly —
   signature, `aud`, `iss` and expiry — a decoded-but-unverified JWT is an
   unauthenticated caller naming any phone number they like.
3. `send-otp` and the MSG91 widget path stay until the Firebase path is proven,
   then retire together. `send-otp`'s abuse controls move to whatever endpoint
   ends up unauthenticated.

### Owner directive, 2026-09-06 — remove MSG91

_"remove msg91 that path was never proven successful."_ Point 3 above is
superseded: MSG91 did not wait for the Firebase path to be proven, it went
first. The owner is right about the premise, and it is checkable —
`OTP_LOGIN_ENABLED` has been `false` since the credentials went missing, so the
phone tab never rendered for anyone. **MSG91 was not a working fallback being
kept for safety; it was a disabled client path with a live, unauthenticated
server surface behind it.**

DELETED: `send-otp`, `verify-otp`, `msg91-verify-session`, `get-otp-config`,
and `check-user-exists` — the last of which is the one to notice. It answered
whether an ONIQ account exists for a phone number or an email, guarded only by
a static key in the URL, for a widget that no longer had a caller. Also gone:
`toWidgetFormat` (MSG91 wanted digits-only; Firebase wants E.164 with the `+`),
the WhatsApp/voice re-delivery buttons (Firebase Phone Auth is SMS only), and
the 4-digit branch of the code input (MSG91 widgets were configurable; Firebase
codes are always six).

**WHAT SURVIVED THE PROVIDER BEING REMOVED UNDERNEATH IT, and why that was
worth building.** `otpFlow.ts` takes its provider as an argument, so every test
of the send/verify state machine — bad code, expired code, dropped network —
kept passing through the swap, because not one of them ever knew who the
provider was. The frozen `phone_<digits>@oniq.phone` derivation survived too,
deliberately: any account the old path did create signs in as ITSELF through
the new one. `src/lib/__tests__/phoneIdentityAgreement.test.ts` now asserts the
inverse of what it used to — that `_shared/phoneIdentity.ts` is the only place
that derivation lives.

**THE RESEND BUG THAT WOULD HAVE SHIPPED, found by asking what the second tap
does.** An invisible reCAPTCHA token is SPENT by the send it authorises, so one
verifier held across sends breaks the second one — which is the resend button,
i.e. exactly the path a user reaches when the first SMS is slow. Firebase
reports that as a captcha error and `otpFlow` would surface it as "couldn't
send the code", blaming the network. `firebasePhoneSurface` now builds a fresh
verifier per send and `clear()`s the previous one; fixing only the first half
throws instead, because Firebase refuses a container that already holds a
widget. Neither half is reachable from a unit test, so both are written down at
the call site.

`src/lib/__tests__/phoneSignInWiring.test.ts` pins the two things a typecheck
cannot see: that the reCAPTCHA container id is ONE constant used both to render
the node and to build the surface (rename either alone and sign-in breaks only
for the person who taps the button, in production), and that the MSG91 surface
stays deleted. Its brace-counting assertion replaced one that looked for `)}`
between the ternary and the div — a string the form itself contains, so it
passed identically with the node moved into the branch it is meant to be
outside of. Measured both ways: net braces 0 outside, 1 inside.

**STILL FLAGGED OFF, and what flips it.** `OTP_LOGIN_ENABLED` stays `false`:
the reason it was off — no code has ever been observed to arrive — is not
changed by changing who sends it. Firebase's TEST PHONE NUMBERS (Authentication
-> Sign-in method -> Phone -> numbers for testing) run the whole real flow with
a fixed code and send no SMS, so proving it costs nothing. Prove it there, then
on one real handset, then flip.

**AND DELETING SOURCE DOES NOT UNDEPLOY — and the undeploy is correctly
BLOCKED, which turned out to be the interesting part.** Asked to delete the five,
the Lovable agent refused, in its tooling's own words:

    Edge functions were not deleted. The migrated TanStack app is not published
    at the latest commit yet. Leave the deployed Supabase functions live as
    rollback coverage; publish and verify the app first, then delete them in a
    later turn.

That guard caught a real ordering error, not a false positive. `claude/check-56jtg5`
is 2 commits ahead of `origin/main`, so the PUBLISHED bundle still contains the
MSG91 client code that calls `get-otp-config` and `msg91-verify-session`.
Deleting them today would be deleting a dependency of the live app — harmless
only because `OTP_LOGIN_ENABLED` gates it, which is luck, not design. **The order
is merge -> publish -> verify the served chunks no longer name those functions ->
then delete.** All five confirmed still live, and one probe is worth keeping:

    send-otp              400 {"error":"invalid Indian phone number"}
    verify-otp            400 {"error":"invalid phone or otp"}
    msg91-verify-session  500 {"error":"otp service not configured"}
    get-otp-config        200 {"widgetId":"…","tokenAuth":null,"ready":false}
    check-user-exists     405 {"error":"method not allowed"}   (GET-only)

`ready:false` is the owner's premise, measured: MSG91 never had working
credentials. And **`check-user-exists` fails CLOSED** — `CHECK_USER_KEY` is
unset, so it 401s every request. It was called "a live account-existence oracle"
earlier in this session, including in the message asking for its deletion; that
overstated it. It is hygiene to remove, not an open door. State the guard, then
check whether the guard is armed.

### 2026-09-06 — the phone path, PROVEN, for zero money

Measured with a Firebase TEST PHONE NUMBER, which runs the entire real flow with
a fixed code, sends no SMS and needs no reCAPTCHA — so it is reachable from a
server with only the PUBLIC web key. Added and removed again with the service
account in the same run; both throwaway records deleted.

    sendVerificationCode                 200  sessionInfo
    signInWithPhoneNumber                200  a real Google-signed ID token
    verifyFirebaseIdToken vs LIVE JWKS   ACCEPTED  (RS256, iss/aud oniq-309bd,
                                                    sign_in_provider phone)
      wrong project id                   rejected: bad iss
      tampered signature                 rejected: bad signature
      clock +2h                          rejected: expired
    POST firebase-phone-session          200  {"verified":true,
                                               "email":"phone_…@oniq.phone"}
    GET  /auth/v1/verify?type=magiclink  303  access_token returned
    GET  /auth/v1/user with it           200  phone_9000000001@oniq.phone
                                              {auth_via:"firebase_phone",
                                               phone_verified:true}

**THE VERIFIER HAD NEVER SEEN A REAL TOKEN.** `firebaseIdToken.test.ts` mints its
own RSA keys, which proves the checking logic and proves nothing about whether it
agrees with Google's actual key format, kid rotation or claim shapes. It does.
The three controls on the SAME real token are what make "ACCEPTED" mean
something — without them it could equally be a verifier that accepts everything.

**AND ISSUING A token_hash IS NOT MINTING A SESSION.** The run before this one
stopped at the function's 200 and looked finished. It wasn't: the session is the
sign-in, and only the last two lines say it happens. Two Supabase calls with no
ONIQ code between them "very probably work" — which is exactly how the MSG91 path
shipped and sat dead.

`scripts/prove-firebase-phone.ts` re-runs the free half (`npx tsx`). Its header
carries the setup PATCH and the warning not to circulate that response body: it
also contains `hashConfig.signerKey`, which the Lovable agent spotted and
flagged unprompted.

**WHAT IS STILL UNPROVEN, and it is now only two things**: the reCAPTCHA a real
number requires in a real browser on `oniqhub.com`, and whether an SMS actually
ARRIVES. Test numbers skip the attestation step — that is what makes them free,
and it is precisely the step production depends on.

**THE DEADLOCK.** Both remaining facts need a real handset on the live site;
while the flag is off the tab never renders, so there is nothing to test
against. `phoneLoginVisible()` in `flags.ts` was built to break it — `/auth?phone=1`
opts ONE browser in, so delivery could be proven for the price of one SMS
before the tab went live for everyone. It is not a security boundary and must
not become one: it decides who SEES the tab, and Firebase's reCAPTCHA guards
the send either way.

### Owner directive, 2026-09-06 — `OTP_LOGIN_ENABLED = true`

Asked to choose, with the evidence above and the two unproven facts stated
plainly, and with the one-handset canary offered as the alternative, the owner
chose **"Merge and publish, and flip the flag too."** Recorded as given. Phone
sign-in is live for all 125 users with reCAPTCHA-on-`oniqhub.com` and actual SMS
delivery unproven; **the first real sign-in is the test.**

That inverts what the canary is for: it is now the ROLLBACK path, not the
rollout one. Setting `OTP_LOGIN_ENABLED` back to false is a one-word change that
needs nothing else, and `?phone=1` immediately puts it back into one-browser
mode so whatever failed can be diagnosed without the tab being live. Which
symptom means what is written beside the flag — "couldn't send the code" on
every attempt is reCAPTCHA (check `oniqhub.com` is still authorized, and that
nothing is serving from `www.oniqhub.com`, which is NOT); the code box appearing
with no SMS is delivery, which is Google's side and lands on the Blaze bill.

**A TEST CAN STOP TESTING WITHOUT FAILING, and this flip is how that gets
found.** `phoneLoginVisible` short-circuits on the flag, so every parameter
assertion written against it became vacuous the moment the flag went true —
`?phone=0`, `?telephone=1`, all of them returned true and all of them passed,
because the function no longer looked at the string. Nothing went red. The parse
is now a separate export, `phoneOptInParam`, and that is what
`src/lib/__tests__/phoneLoginVisible.test.ts` targets; mutation-checked with the
flag ON, breaking the parse still fails. Where a test's subject can be
short-circuited by a flag, test the part the flag cannot reach.

**AND THE BUILD CANNOT BE PROVEN IN THIS CONTAINER.** `npm run build` emits 423
chunks and then fails on one line —
`Rolldown failed to resolve import "@firebase/app"` — because every
`node_modules/@firebase/*` package is EMPTY here: 0 entries, against 20 proxy
denials to `europe-west1-npm.pkg.dev`, Lovable's Artifact Registry mirror. That
is the environment, not the code, and it means a green local build is not
available as evidence for anything touching the Firebase SDK. Have the Lovable
agent build before publishing rather than discovering it from a failed deploy.

**MEASURED THE SAME DAY, and one correction.** `getProjectConfig` on the public
key now returns `authorizedDomains: ['localhost', 'oniq-309bd.firebaseapp.com',
'oniq-309bd.web.app', 'oniqhub.com']` — the owner DID add it, and the
"`oniqhub.com` IS STILL NOT AN AUTHORIZED DOMAIN" line recorded above was wrong
by the time it was written. `www.oniqhub.com` is still absent, which matters only
if the site is ever served from the www host. `smsRegionConfig.allowlistOnly` is
`[IN, US, GB, AU]`.

**EMAIL/PASSWORD SELF-SIGNUP IS STILL OPEN** — re-measured, `accounts:signUp`
with the public web key returns 200 and creates an account. Anonymous is
correctly locked (`ADMIN_ONLY_OPERATION`). It buys an attacker nothing under the
phone-OTP-only directive, because no Firebase token is ever presented to
Postgres, but it is unbounded account creation in the owner's project and was
almost certainly never intended. Still an owner console action.

One number that settles a question this file kept circling: **the Firebase
project holds ZERO users.** The only account in it was one this session created
by probing `accounts:signUp`, since deleted. ONIQ's identity is entirely
Supabase, exactly as the final directive says.

## ONIQ Study and the Google mapping — what is built, what cannot be

The owner mapped ONIQ Study onto thirteen Google capabilities, 2026-09-05.
Most of it already exists, and one part of it cannot be built with the
credentials the mapping assumes. Both facts change what is worth doing next.

ALREADY BUILT, and running in production today:

| Mapping row                 | Where it lives                                                        |
| --------------------------- | --------------------------------------------------------------------- |
| AI tutor                    | `study-tutor` — Gemini via shared `callText`, with attachments        |
| Explain textbook material   | `study-chapters`, `study-chapter-notes`, cache-first                  |
| Generate practice questions | `study-quiz`                                                          |
| Generate mock exams         | `study-paper-generate`, `study-paper-mock`                            |
| Evaluate written answers    | `study-paper-grade` — reads a PHOTO of handwriting                    |
| Analyze mistakes            | `study-paper-review`, `quiz_attempts`, `src/lib/retrievalPractice.ts` |
| Personalized learning       | `learner_profiles` + the Study Vault (FTS over `study_notes`)         |
| Images/diagrams             | already multimodal, same `callText` path                              |

Nine Postgres tables carry it: `learner_profiles`, `chapters`,
`chapter_notes`, `chapter_overrides`, `study_papers`, `study_notes`,
`study_messages`, `quiz_attempts`, `study_chapters_debug`. **Do not rebuild
any of this.** The gap is not capability, it is persistence and reach.

WHAT THE FIREBASE SERVICE ACCOUNT ACTUALLY ADDS: **durable study documents.**
Measured 2026-09-05 — attachments today are EPHEMERAL. `app.study.tsx` turns
the file into base64 in the browser (`fileToBase64`), `study-tutor` forwards it
inline to the model, and nothing is stored. Same for the handwriting photo in
`study-paper-grade`. So a student re-uploads the same worksheet every session,
the tutor cannot refer back to the chapter PDF from last week, and a graded
answer sheet cannot be reopened. That is exactly the owner's "Storage =
photos/videos/files" row, it needs no console and no new credential, and the
bridge does it today.

`file.list` was added to the bridge for this: without it an uploaded file is
unfindable unless the caller already remembers the exact name, which is
indistinguishable from never having stored it. **Listing makes the bucket its
own index**, which is why Study needs no document table — a table would be a
second source of truth that drifts from the bucket the first time an upload
half-fails.

WHAT THE FIREBASE CREDENTIALS CANNOT DO, and this is the load-bearing
correction: **Classroom and Drive are not Firebase.** Five of the thirteen rows
(import assignments, import courses, submit coursework, grades/progress, study
documents-via-Drive) read a STUDENT'S OWN Google account. That data belongs to
the student and their school's Workspace domain, not to project `oniq-309bd`,
so a service account cannot reach it without domain-wide delegation granted by
that school's Workspace admin — which ONIQ is not. The ordinary route is a
per-user OAuth consent flow, and `oniq-309bd` has **no OAuth client at all**
(measured 2026-09-05, `android/app/google-services.json`).

That is stated as the expected answer, not a measured one. `firebase-provisioning`
now carries two read-only probes — `classroom.googleapis.com/v1/courses` and
`drive/v3/about` on the service-account token — so the next tap of
`/app/admin/firebase` returns Google's own refusal under `googleWorkspace`,
naming which of missing-scope or missing-consent applies. Replace this
paragraph with that output when it arrives; do not build against the guess.

THE YOUTUBE ANSWER, decided 2026-09-05 and then corrected by a guard this
repo already had. The owner chose "YouTube Data API only" of the new surfaces.
Search is the wrong shape for it, and that is measured rather than argued:

- `src/data/__tests__/watchChannels.test.ts` carries a REPO-WIDE assertion,
  "never calls search.list — 100 units would drain the free daily quota". It
  greps every non-test source file for `youtube/v3/search`. So the obvious
  implementation fails CI, by a guard written for exactly this reason.
- The arithmetic behind it: `search.list` costs 100 units of a 10,000/day
  default allowance. That is **100 searches per day for the whole app**, across
  125 users — under one per student per day. A feature that stops working
  mid-morning is not a feature. (The 10,000 figure is Google's documented
  default; this container cannot reach their quota page, so it is recorded as
  given, the way the model prices are.)
- **The cheap calls are the way in.** `playlistItems.list` and `videos.list`
  cost 1 unit each, so the same allowance buys 10,000 calls a day. Curate a
  small roster of board-aligned playlists — the shape `WATCH_CHANNELS` already
  uses — and list their items instead of searching. Zero search quota, and the
  embed path is the one `liveEmbedUrl` already proves.
- Whichever way it goes, the 2026-08-16 Watch rules still bind: ONIQ resolves,
  stores and proxies NO stream URL, playback is YouTube's own embed, minimum
  player size, nothing rendered in front of it.

**Not built.** Choosing which playlists represent CBSE class 10 science is a
curriculum decision, not an engineering one, so it waits for the owner's roster
rather than being guessed.

STILL THE OWNER'S CALL, because each chooses a new provider surface:

- **A Google OAuth client** for Classroom and Drive — a consent screen, scopes,
  and Google verification before any student outside a test list can use it.
- **Google Cloud speech** for the voice tutor — ONIQ already ships TTS through
  `voice-generate`, so check that first rather than adding a second vendor.

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

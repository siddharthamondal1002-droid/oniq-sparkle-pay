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

**PUBLISHED AND VERIFIED, 2026-09-06.** `main` at `53354d53`, deployed, and the
served bundle checked on BOTH hosts — `oniqhub.com` and
`oniq-sparkle-pay.lovable.app` serve the identical `assets/auth-CKqjXNGa.js`
(24,205 bytes) and `assets/index-BaLraXI0.js`:

    in the AUTH chunk, both hosts:  firebase-recaptcha           present
                                    oniq-309bd.firebaseapp.com   present
                                    firebase-phone-session       present
    in auth AND entry, both hosts:  verify.msg91.com             absent
                                    initSendOTP                  absent
                                    msg91-verify-session         absent
                                    get-otp-config               absent
                                    otp-provider.js              absent

So phone sign-in is live and MSG91 is gone from the shipped app.

**AND DELETING SOURCE DOES NOT UNDEPLOY — the undeploy is BLOCKED, and the
guard's stated reason is now demonstrably not its real one.** Asked to delete
the five, the Lovable agent refused, in its tooling's own words:

    Edge functions were not deleted. The migrated TanStack app is not published
    at the latest commit yet. Leave the deployed Supabase functions live as
    rollback coverage; publish and verify the app first, then delete them in a
    later turn.

THE FIRST TIME, that guard caught a real ordering error rather than a false
positive: the branch was 2 commits ahead of `origin/main`, so the PUBLISHED
bundle still contained the MSG91 client code calling `get-otp-config` and
`msg91-verify-session`. Deleting them then would have removed a dependency of
the live app — harmless only because `OTP_LOGIN_ENABLED` gated it, which is
luck, not design.

THE SECOND TIME, after the merge, the publish, and the two-host verification
above, it refused with the IDENTICAL text. The app is published at the latest
commit; the guard says it is not. **So whatever it is keyed on, it is not what
its message describes** — and the message is the only thing anyone reading it
has to go on. Do not read that refusal as a statement about the publish state.
The agent holds the service role but no management PAT, and edge-function
deletion is a control-plane operation, so `delete_edge_functions` is its only
route and it will not bypass its own guard (correctly). **Deleting these five is
therefore the OWNER's, from the Supabase dashboard.**

All five confirmed still live, and one probe is worth keeping:

    send-otp              400 {"error":"invalid Indian phone number"}
    verify-otp            400 {"error":"invalid phone or otp"}
    msg91-verify-session  500 {"error":"otp service not configured"}
    get-otp-config        200 {"widgetId":"…","tokenAuth":null,"ready":false}
    check-user-exists     405 {"error":"method not allowed"}   (GET-only)

`ready:false` is the owner's premise, measured: MSG91 never had working
credentials.

**`check-user-exists` FAILS CLOSED — and the second-hand version of that claim
was not good enough.** It was called "a live account-existence oracle" earlier
in this session, including in the message asking for its deletion, which
overstated it. But the correction was itself only source-read: the function
401s when `CHECK_USER_KEY` is unset, and an audit file said it was unset. **This
file's own rule is that a checked-in file is a catalogue, not a probe** — and
the deployed function's ENV had never been measured. The POST probe above says
nothing either: it is GET-only, so 405 is about the method, not the auth.

Measured properly 2026-09-06, with the verb the endpoint actually takes:

    GET /functions/v1/check-user-exists?identifier=probe@example.invalid
    -> 401 {"error":"unauthorized"}

So it is genuinely inert, and removing it is hygiene rather than urgency. State
the guard, then check whether the guard is armed — and check it with the verb
the guard actually sees.

**WHY THE DELETE GUARD PROBABLY WILL NOT CLEAR, as a hypothesis and labelled
one.** Asked what it keys on, the Lovable agent said honestly that it can see
only its own rule text — "do not use this tool during a Classic-to-TanStack
migration before the migrated app is published at the latest commit" — and has
no visibility into the signal evaluated. Its lead: there is a migration
lifecycle on its side with explicit complete/halt states, and if this project
carries an open Classic-to-TanStack record never marked complete, the guard
would be keyed on THAT rather than on anything deployed, which would explain a
refusal that survives any publish. Treat as a hypothesis. The practical answer
is unchanged either way: the five are inert and nothing in the shipped bundle
references them, so the owner can delete them from the Supabase dashboard.

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

**THE BUILD COULD NOT BE RUN HERE, AND THAT IS NOW FIXED AT THE ROOT.** It used
to die on `Rolldown failed to resolve import "@firebase/app"` because every
`node_modules/@firebase/*` package installed EMPTY — 0 entries — against proxy
denials to `europe-west1-npm.pkg.dev`. That was not a Firebase problem. It was
the lockfile: **70 entries** had `resolved` URLs pointing at Lovable's Artifact
Registry mirror, and this container cannot reach it.

CI caught it as `check:deps` failing on `firebase` (103/104). The check only
inspects DIRECT dependencies, so it named one package while 69 more — the whole
`@firebase/*` tree plus grpc, protobufjs, websocket-driver, idb — were in the
same state. **Read the count, not the name.**

Resolved by the procedure `oniq-ship` and the check itself prescribe, not by
relaxing anything:

    for each of the 70: npm view <pkg>@<ver> dist.integrity  vs  the lockfile
    -> MATCH 70   MISMATCH 0   MISSING 0

    repointed `resolved` to each package's own dist.tarball from the public
    registry (not a hand-built URL); every `integrity` left untouched, and the
    before/after key sets and integrity maps asserted identical

    npm ci  -> exit 0, no EINTEGRITY

**The clean `npm ci` IS the proof**, because it verifies every tarball against
the hash the mirror recorded. Had a hash differed the answer was to stop, and
that is the case the check exists for. Now 104/104, and
`node_modules/@firebase/app` has contents.

So the build runs here, and it answers what previously had to be asked of the
Lovable agent:

    Firebase SDK chunk    assets/index.esm-*.js   123.8 KB, split out
    entry index-*.js      0 occurrences of signInWithPhoneNumber
    firebase-recaptcha            -> assets/auth-*.js
    oniq-309bd.firebaseapp.com    -> assets/auth-*.js
    firebase-phone-session        -> assets/auth-*.js
    verify.msg91.com / initSendOTP / msg91-verify-session /
      get-otp-config / otp-provider.js   -> 0 chunks each

Three facts fall out. The literal dynamic import works — the SDK is its own
chunk and the entry never mentions it, so sessions that never sign in by phone
never fetch those 124 KB. The six `VITE_FIREBASE_*` values DO inline from
`.env`, so `FIREBASE_WEB.configured` is true; had they not, `phoneAvailable`
would be false and the phone tab would simply never render — no crash, no
console error, just an absent tab. And MSG91 is gone from every chunk.

**VERIFY PRODUCTION AGAINST `auth-*.js`, NOT THE ENTRY BUNDLE.** All three
markers live in the auth route chunk and none in `index-*.js`; greping the
entry would come back clean and read as a stale deploy — the same false
negative that nearly got a healthy Episode 4 deploy re-published.

Expect the mirror URLs to come back the next time the Lovable agent installs
anything, since its sandbox genuinely resolves through that mirror. The fix is
this same procedure, not a lockfile the check ignores.

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

**THE FAILED BUILD IS STILL USEFUL, though, and this is the part worth copying.**
It dies at the Firebase resolution step, AFTER emitting 423 chunks — so it
answers `oniq-ship`'s "learn which chunk carries your marker from a local build
first" without needing to succeed:

    firebase-recaptcha           -> assets/auth-*.js
    oniq-309bd.firebaseapp.com   -> assets/auth-*.js
    (entry index-*.js carries neither)

So production is verified by fetching the AUTH ROUTE chunk, not the entry
bundle. Greping `index-*.js` would have returned clean and been read as "the
deploy is stale" — the exact false negative that nearly got a healthy Episode 4
deploy re-published.

It also settles the silent-failure risk for free: `oniq-309bd.firebaseapp.com`
being present proves the six `VITE_FIREBASE_*` values inline from `.env` at
build time, so `FIREBASE_WEB.configured` is true. Had they not inlined,
`phoneAvailable` would be false and the phone tab would simply never render —
no crash, no console error, just an absent tab. That check does not depend on
the Firebase package resolving, so the local result transfers.

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

### 2026-09-06 — the first real sign-in FAILED, and the flag is off again

`OTP_LOGIN_ENABLED` went true, and minutes later the owner tapped "get otp" for
a real +91 number on a real handset in the Android app. The entire diagnostic
was:

    Firebase: Error (auth/internal-error).

So the unproven half is DISPROVEN. Rolled back to false the same hour — the tab
rendered for all 125 users and errored for every one of them, and
`phoneLoginVisible` returns it to `/auth?phone=1` so it stays reachable while
being fixed.

**THE ROLLBACK WORKED AS DESIGNED, WHICH IS THE ONE GOOD RESULT HERE.** One
word, no other change, and the canary immediately became the diagnosis path
instead of the rollout path. Build a flag with its own retreat and the bad day
costs a line.

WHAT IS RULED OUT, by measurement rather than by reasoning — worth keeping,
because each of these was a plausible headline and each is now dead:

    the web config        the tab RENDERED, so FIREBASE_WEB.configured is true
                          and all six VITE_FIREBASE_* inlined
    the authorized domain capacitor.config.json loads https://oniqhub.com with
                          androidScheme https, so the WebView origin IS the
                          apex, which IS on authorizedDomains
    the www host          www.oniqhub.com 302s to the apex before any Firebase
                          call runs — measured, and note this had been written
                          off with an unverified caveat ("only matters if
                          anything serves from www") when www in fact resolves
                          to the SAME Cloudflare IPs. Right conclusion, wrong
                          reasoning, caught only because the owner asked where
                          the claim came from
    region and provider   a server-side sendVerificationCode still reaches
                          MISSING_CLIENT_IDENTIFIER, i.e. past both checks
    the server chain      proven end to end with a test number, through to a
                          real Supabase session

**`auth/internal-error` IS NOT A DIAGNOSIS.** It is the SDK's catch-all for an
unexpected Identity Toolkit response, so one string covers a blocked API key,
App Check enforcement, an unsolved reCAPTCHA and a Google outage — four faults,
three different owners. The real text sits on `customData.serverResponse` and
the SDK hides it. `firebaseErrorDetail` in `firebasePhoneOtp.ts` now unwraps it
and the send path rethrows with it attached, so the NEXT attempt names the
fault. Both `serverResponse` spellings are read, because pinning one is how a
diagnostic silently reverts to useless after a dependency bump.

CANDIDATES, none measured, in the order worth checking:

1. **API key restrictions.** A server call carries no `Referer` and succeeds; a
   browser call sends one. An HTTP-referrer restriction on the web key that
   omits `oniqhub.com` would break exactly the browser and nothing else — which
   is precisely the observed split.
2. **App Check.** The console pass on 2026-09-05 visited App Check and Play
   Integrity. Nothing in this codebase registers an App Check provider, so if
   enforcement was turned on for Authentication every client call is unattested.
3. **The WebView.** reCAPTCHA runs in an iframe on the authDomain and can fail
   under an embedded WebView's storage rules. Opening the same page in Chrome
   on the phone separates this from 1 and 2 for free, and is the cheapest next
   move.

**DO NOT RE-ENABLE ON A GREEN BUILD.** tsc, lint, 4753 tests and a verified
two-host publish were all green at the moment it broke. The gate is a code
arriving on a handset.

### 2026-09-06 — phone sign-in WORKS. The cause was ONIQ's own CSP.

Owner, after `feecc298` shipped: _"otp came, working now."_ A real code, on a
real handset, on a real number. That is the gate `flags.ts` held out for all
day — a code ARRIVING, not a green build. Every green build in this saga was
green while the feature was broken.

**AND THE PROCESS FAILURE IS THE PART WORTH KEEPING.** The owner's verdict:
_"if you don't understand something ask rather than speculation and wasting
hours where its a simple solution."_ Correct, and specifically so. A CSP
violation prints a loud, explicit console message naming the exact blocked URL.
Asking "what does the browser console say?" after the FIRST `auth/internal-error`
would have ended this in ten minutes. Instead six hypotheses were run off a
single error string, four publishes went out, Lovable credits went on probing
App Check, API keys, referrer restrictions and authDomain helpers — and the
answer was found by accident, when an unrelated Playwright probe failed and
prompted a glance at `gen-headers.ts`.

Worse, the evidence was already in hand. `no-server-response` means the failure
is LOCAL. It was instrumented, printed on the owner's screen, and then reasoned
past in favour of theories about Google's configuration.

**WHEN YOU CANNOT SEE SOMETHING, ASK FOR IT.** A console, a network tab, a
response header. Inferring around a gap that one question would close is not
diagnosis, and a confident narrative built on one error string is the most
expensive thing an agent can produce.

### 2026-09-06 — how it was found (six candidates, five irrelevant)

Six candidates, five killed by measurement, and the sixth confirmed by naming
the step. The instrumented error, verbatim from the handset:

    recaptcha-verify: Firebase: Error (auth/internal-error).
      [code=auth/internal-error no-server-response
       code=auth/internal-error customData={} name=FirebaseError]

**`recaptcha-verify` is the step, and `no-server-response` with `customData={}`
is the proof of where.** `verifier.verify()` fails — the browser cannot produce
an attestation — so nothing is ever sent. Google did not refuse ONIQ; Google was
never asked. Every project-side theory was therefore doomed from the start, and
the ones already dead are dead for the right reason:

    App Check              identitytoolkit -> UNENFORCED
    API key restrictions   an evil.example.com Referer control returned the
                           SAME error as the real host, so the key is unrestricted
    authorized domain      the WebView loads https://oniqhub.com (androidScheme
                           https), and www 302s to the apex
    authDomain helper      /__/auth/iframe.js -> 200, 288 KB, provisioned
    the server chain       proven end to end with a test number, to a session

**AND THE CAUSE WAS OURS. It was the CSP.** `src/lib/securityHeaders.ts` named
`googletagmanager`, `youtube`, `s.ytimg` and `checkout.razorpay` in `script-src`,
and `accounts.google.com` plus the players in `frame-src`. reCAPTCHA needs
`www.google.com` for `recaptcha/api.js`, `www.gstatic.com` for its assets, and
`www.google.com` again to frame the challenge; the SDK also frames its helper on
`oniq-309bd.firebaseapp.com`. **Not one of those was allowed.** The browser
blocked the attestation before a request could be made — which is precisely what
`no-server-response` with an empty `customData` was saying.

So it was never the WebView. It would have failed in Chrome, on a laptop, and in
the Custom Tab that was about to be built to "fix" it. The fix is four origins.

WHY IT TOOK SIX ROUNDS, worth recording because the shape recurs:

- **A first-party header is not where you look when a Google flow fails.** Every
  hypothesis was about Google's configuration — App Check, key restrictions,
  authorized domains, the authDomain helper. The one thing under ONIQ's own
  control was never suspected _because_ it is ONIQ's.
- **A familiar precedent made the wrong answer feel confirmed.** `auth.tsx`
  carries a real "Google blocks OAuth inside embedded WebViews" lesson for
  Custom Tabs, so "embedded WebView breaks Google attestation" arrived
  pre-believed and stopped the search one step early.
- **`accounts.google.com` in `frame-src` made the policy look covered.** It is
  OAuth's origin, not reCAPTCHA's. Skim-reading a directive for "google" is not
  reading it.
- The evidence was right all along: `no-server-response` says the failure is
  local. That was surfaced, printed on the owner's screen, and still read as a
  statement about Google rather than about us.

**AND PLAY INTEGRITY IS THE OTHER HALF OF THE SAME FACT.** Native Firebase
phone auth does not use reCAPTCHA at all: it attests with Play Integrity, which
is why the SHA-256 the owner was asked for exists. So the SHA was never
irrelevant — it was irrelevant _to the web SDK_, which is what ONIQ runs. Under
the native route it becomes required. Saying "the SHA is not on the code path"
was true and incomplete, and the incompleteness read as dismissal.

FIXED by adding the four origins, with
`src/lib/__tests__/securityHeaders.test.ts` asserting each and mutation-checked
(removing them fails two tests). `public/_headers` is regenerated from the same
source by `scripts/gen-headers.ts`, so the static and runtime policies cannot
drift.

The two architectural routes below were costed while the diagnosis was still
wrong. **Neither is needed.** They are kept only because a future native phone
auth would still want the second, and the SHA-256 belongs to it:

1. **Custom Tab**, reusing the pattern already in this file for Google OAuth.
   `@capacitor/browser` is already a dependency and `/auth-native-callback` plus
   the `com.oniqhub.app://auth-callback` scheme are already registered in the
   manifest. No Play release: it is web code plus deep links that already exist.
   DEPENDS ON reCAPTCHA working in mobile Chrome, which is NOT yet measured.
2. **Native phone auth** via a Capacitor Firebase plugin — attests with Play
   Integrity, no reCAPTCHA anywhere. Needs a new dependency (Lovable's to add),
   the SHA-256 registered on the Firebase Android app, and a Play release to
   reach users. Slower, and the one Google actually designs for.

**THE TEST THAT PICKS BETWEEN THEM COSTS ONE MINUTE**: open
`https://oniqhub.com/auth` in Chrome on the same handset. Working there means a
Custom Tab works, because a Custom Tab IS Chrome. Failing there kills option 1
outright and leaves only the native route.

## Owner directive, 2026-09-06 — the payment architecture, and Firebase BECOMES the identity (again)

The owner mapped ONIQ's payments onto Google Play Billing for digital goods and
UPI for everything else, and then answered the three questions that mapping
raised. The full specification, with the repo inventory behind it, is the
artifact linked from that session; what binds is here.

    1. Firebase Auth + Firestore   YES — "yes I authenticate"
    2. UPI in the entitlement layer NO  — "UPI stays facilitation only"
    3. RevenueCat vs direct         no preference -> DIRECT Play Billing

**THIS SUPERSEDES THE 2026-09-05 FINAL DIRECTIVE ON THE IDENTITY QUESTION.**
"PHONE OTP ONLY. Supabase stays the identity" no longer holds. It also
supersedes "Postgres stays the system of record" FOR PAYMENTS AND ENTITLEMENTS
ONLY — the owner was shown that conflict in its own words and confirmed anyway.
Everything else in the 2026-09-05 mapping stands.

**THE UID-PRESERVATION PLAN IS NO LONGER DORMANT. IT IS THE PLAN.** The 125
users are imported into Firebase with their existing Supabase UUID as the
Firebase uid, plus the `role: 'authenticated'` custom claim.
`scripts/firebase-import-users.mjs` already does exactly this and carries
`phoneNumber` across. Read its header before touching it.

Decision 3 was delegated, so it was made here and is recorded as an
ENGINEERING call, not an owner one: **direct Play Billing.** It is what the
owner's own architecture described, it adds no paid fourth party taking a cut,
and it needs no new `package.json` dependency — which matters because Lovable
owns that file and every dependency is a round trip. The hard half is
server-side and `parked/creator-billing/play-rtdn.ts` already implements it.
RevenueCat stays parked and is the fallback if renewal edge cases bite.

### THE BLOCKER THAT CHANGED SEVERITY THE MOMENT THIS WAS DECIDED

**EMAIL/PASSWORD SELF-SIGNUP IS OPEN, AND IT IS NOW AN RLS OUTAGE VECTOR
REACHABLE BY ANYONE.** Measured again 2026-09-06 with nothing but the PUBLIC
web API key — the one that ships in every browser bundle by design:

    POST accounts:signUp?key=<WEB_KEY>  {"email":…,"password":…}
    -> HTTP 200   localId 8KkQ87d0WnUcN93aAlkkldsjkKo1   idToken 932 bytes

That `localId` is a NATIVE 28-CHARACTER UID, not a UUID. (The probe account was
deleted in the same run; `accounts:lookup` on its token then answered
`USER_NOT_FOUND`.)

Under the previous directive this was harmless and this file said so in those
words — no Firebase token was ever presented to Postgres. **The decision above
is what makes it critical.** Once Firebase is registered as Supabase's
third-party auth provider, that token IS accepted, `auth.uid()` casts the `sub`
claim to `uuid`, and per `scripts/firebase-import-users.mjs`'s own header a
native uid "would not merely fail to match rows — it would fail to CAST, and
every policy on every table would error."

So this is not "unwanted accounts". It is an unauthenticated, remote way to
make all 242 RLS policies error, reachable by anyone who reads the shipped
bundle. **Turn Email/Password OFF in the Firebase console before registering
third-party auth, not after.** Order matters: registering first opens the hole
for as long as the console tab takes.

Anonymous sign-in remains correctly locked (`ADMIN_ONLY_OPERATION`).

**AND A SERVER-SIDE SIGNUP ENDPOINT IS STILL REQUIRED, for the same reason.**
Turning the provider off closes the public hole; it does not give new users a
way in. Phone sign-in must not be the account-creating step — a server endpoint
takes the phone first and calls `createUser({ uid: <a fresh UUID>, phoneNumber,
customClaims: { role: 'authenticated' } })`, and only then does the client call
`signInWithPhoneNumber`, which now RESOLVES to that account instead of minting
one. The shape was recorded on 2026-09-05 and was moot under the phone-OTP-only
directive. It is live work again.

### MEASURED 2026-09-06, free, with no credential ONIQ must protect

    accounts:createAuthUri     POST -> 200   Auth IS provisioned
    projects                   GET  -> 200   authorizedDomains: [localhost,
                                             oniq-309bd.firebaseapp.com,
                                             oniq-309bd.web.app, oniqhub.com]
    accounts:signUp            POST -> 200   Email/Password STILL OPEN
    accounts:signUp (no email) POST -> 400   ADMIN_ONLY_OPERATION, anonymous locked

`node scripts/check-firebase-blockers.mjs` re-runs all four and exits non-zero
while any blocker stands. It CREATES NOTHING — the obvious signup probe left a
real account in the owner's project on its first run (deleted in the same run,
`accounts:lookup` then answering `USER_NOT_FOUND`), so it now sends a
deliberately too-short password instead: Google validates the password BEFORE
creating anything, and the provider's state comes back in which error arrives —
`WEAK_PASSWORD` means open, `OPERATION_NOT_ALLOWED` means closed. A diagnostic
that mutates what it measures is not a diagnostic.

**AND THE AUTHORIZED-DOMAINS ENDPOINT IN THIS FILE WAS WRONG ALL ALONG.** Every
earlier entry above names `relyingparty/getProjectConfig`. Measured 2026-09-06
on both verbs, that path returns Google's HTML **404**; the endpoint that
answers is `GET /v1/projects`. The wrong name survived because the command
carrying it ended in `|| curl <other endpoint>` — the parse failed, the
fallback fired silently, and the RIGHT data arrived from the WRONG URL and was
written down under it. The domain values recorded earlier are correct; only the
endpoint attributed to them is not. **Never let a probe fall back to a second
endpoint without printing which one answered.**

`www.oniqhub.com` is still absent from authorizedDomains and still does not
matter, because www 302s to the apex before any Firebase call runs.

### WHAT IS BLOCKED, AND WHO OWNS EACH

Nothing client-side ships until the first two clear, and they are BOTH the
owner's — the Lovable agent holds the service role, and third-party auth
registration is a CONTROL-plane operation it measurably cannot reach
(`api.supabase.com` -> `JWT failed verification`).

    1. OWNER   Turn Email/Password OFF          <- do this FIRST, see above
    2. OWNER   Register Firebase as a third-party auth provider on the
               Supabase control plane. Measured NOT registered 2026-09-05:
               PostgREST answered 401 PGRST301 "No suitable key was found to
               decode the JWT" to a correctly-shaped Firebase token.
    3. OWNER   Confirm Firestore is provisioned (Native mode, which region).
               One tap on /app/admin/firebase asks Google with the service
               account and answers it; the unauthenticated probe cannot.
    4. AGENT   Import the 125 users, uid preserved. Reversible: the Supabase
               accounts are untouched by an import.
    5. AGENT   Server-side signup endpoint (above), then the client switch.

**DO NOT BUILD AGAINST BLOCKER 2 UNTIL IT IS MEASURED CLEARED**, and measure it
the way this file already prescribes: present a real Firebase ID token to
PostgREST with a THREE-WAY control, and get a known-good `apikey` +
`Authorization` pair returning 200 FIRST — the 2026-09-05 run's control arm
returned `401 {"message":"Invalid API key"}`, which is PostgREST rejecting the
apikey header, so it never exercised what it was meant to.

### 2026-09-06 — UPI Rail B: the merchant QR that pays in PhonePe and fails in ONIQ

**THE OWNER'S CORRECTION IS THE WHOLE FINDING, and the first conclusion drawn
from it here was wrong.** A society's SBI collection QR, ₹3,300. It was recorded
above as a bank/account-type refusal because PhonePe said so —
`"UPI payments are not allowed on either your account type or the receiver's
account type"`, UTR 586505577554. The owner then supplied the control that kills
that reading: **the same QR, the same amount, the same handset, scanned in
PhonePe's OWN scanner, went through.** Payer, payee, amount and QR are therefore
all known-good, and the error string was describing a symptom, not the cause. An
error message from a third party is evidence about what it refused, never about
why — the CSP saga three sections up is the same lesson.

FOUR CANDIDATES KILLED BY EXECUTION, not by reading:

    router round trip     `raw` through defaultStringifySearch/defaultParseSearch
                          -> byte-identical, pa/pn/mc/tr/mode/orgid/cu/sign intact
    a non-URI QR          resolveScannedCode returns "unknown" for anything that
                          is not upi://pay, which never reaches the pay screen
    merchant fields dropped  the payee-only fallback — real, fixed in a2cde2ad
    encoding corruption   URLSearchParams turning pa=x@y into x%40y and spaces
                          into "+" — real, fixed in 47b5906b

**AND ON THE OWNER'S STATED REPRO EXACTLY ONE VARIABLE IS LEFT.** Scan and
change nothing and `rawIntact` is true in `app.upi.tsx`, so `amendUpiUri` never
runs and the query is passed through verbatim. Executed against both candidate
QR shapes, the only remaining difference is the SCHEME `retargetUpiUri` swaps in
to skip Android's chooser:

    scanned     upi://pay?pa=officerws@sbi&pn=OFFICERS%20W%20SOCITY&mc=8398&cu=INR
    ONIQ sends  phonepe://pay?pa=…&pn=…&mc=…&cu=INR       query byte-identical

`tez://upi/pay` is Google's documented deep link. **`phonepe://pay` and
`paytmmp://pay` are not documented anywhere in this repository, and nothing here
ever measured that they carry a full NPCI merchant payload** the way the generic
`upi://pay` intent must. PhonePe's own scanner never receives such a link — it
decodes the QR internally — so this is precisely the ONIQ-only step. It is
recorded as **the single remaining candidate, NOT as the cause**: nothing in
this container can ask PhonePe what its deep-link handler does.

**THE EXPERIMENT IS ON THE SCREEN, and it costs one payment rather than six
hypotheses.** `src/components/upi/UpiIntentDiagnostic.tsx` renders under the pay
form whenever a QR was scanned: the scanned bytes, the exact string about to be
handed to Android, a per-field diff, and a banner that names the single variable
when the query survives intact. Test 1 launches the scanned string with no
parsing, no amendment and no retargeting; Test 2 is the ordinary Pay button.
Test 1 first — **if it succeeds the money has moved AND the answer is in.**
`payloadFor()` is shared with `confirmPay` so what the panel shows cannot drift
from what is sent.

**WHAT THIS COST, and it is the same bill as the CSP day.** Two real fixes came
out of the static passes (a2cde2ad, 47b5906b) and both were worth making, but
every test that "proved" them ran against a QR fixture invented here. The real
QR's bytes — whether it carries `sign`, what its `mode` is, whether it already
carries `am` — were never known, and each implies a different defect. Reading
harder does not produce a byte you do not have. Build the thing that reads it.

**LIVE AND VERIFIED, 2026-09-06.** `main` at `08ae2202`, deployed, and the
served route chunk checked — not the entry bundle, because all four markers
live in the route chunk and greping `index-*.js` would come back clean and read
as a stale deploy:

    https://oniqhub.com
      entry      assets/index-BMVJve5D.js
      upi chunk  app.upi-iNnQI_Db.js   25,668 bytes  (was app.upi-BkvMbkaj.js)
      upi-diag-launch-raw   1     upi-diagnostic-toggle  1
      upi-diag-scheme-only  1     upi-confirm-any        1

The chunk's hash CHANGING is half the evidence — an unchanged one would mean the
markers were already there and the deploy did nothing.

**AND `oniq-sparkle-pay.lovable.app` NO LONGER SERVES ITS OWN HTML.** It answers
302 to `https://oniqhub.com/app/upi`, so the two-host check recorded for the
MSG91 removal above ("both hosts serve the identical `assets/auth-CKqjXNGa.js`")
is no longer available as a check — there is one host now, and a `lovable.app`
grep returns empty for a perfectly healthy deploy. Read an empty result there as
"this host does not serve", never as "the deploy is stale".

**THE WORKAROUND ALREADY SHIPS, if the scheme is the fault.** The confirm sheet's
"Any UPI app" button (`upi-confirm-any`) calls `confirmPay(null)`, and
`retargetUpiUri(base, null)` returns the base untouched — so on this repro it
sends bytes IDENTICAL to the diagnostic's Test 1. Two routes to the same control,
one of them in the ordinary UI.

### 2026-09-06 (same evening) — ANSWERED. Both tests failed, and that is the result

Owner: _"both failed"_, then _"transaction declined when retried inside phonepe
was successful"_. So the experiment ran and returned the OTHER branch:

    ONIQ -> Test 1, the raw scanned bytes, ZERO transformation -> PhonePe -> DECLINED
    ONIQ -> Test 2, the ordinary Pay button                    -> PhonePe -> DECLINED
    the same QR scanned inside PhonePe itself                  -> SUCCEEDED

**THE SCHEME HYPOTHESIS IS DEAD, AND SO IS EVERY STRING HYPOTHESIS.** Test 1 is
the QR's own bytes handed to `App.openUrl`, so there is nothing ONIQ could have
built differently. PhonePe OPENED and showed the payment, then refused it — so
the payload arrived intact and **what is refused is the HAND-OFF, not the
payment**. Two days of auditing `amendUpiUri`, `retargetUpiUri`, the router
round trip and the payee-only fallback were auditing a payload that was never
wrong. The last gap in the round-trip proof was closed on the way past: an
alphanumeric `sign` fixture had never exercised `+`, `/`, `=`, `#`, a literal
space or `&` — all six round-trip byte-identical.

**THE COMMENT THAT SENT THIS DOWN THE WRONG ROAD SAID "MERCHANT INTENTS ARE
UNAFFECTED".** It was in `miniapps.ts` beside `upiPayeeLink`, in
`appRegistry.ts` beside the `oniq-upi` entry, and shipped to users as the last
line of the decline panel. It was inferred from the ₹1 P2P refusal — a link
tapped OUTSIDE ONIQ — and the same comment honestly labelled itself "NOT
MEASURED THROUGH ONIQ" and said to treat a send through ONIQ as
expected-to-decline until one was tried. Nobody read that far. A caveat inside
the paragraph does not survive the sentence being quoted; all three copies are
corrected now, and `src/lib/__tests__/upiDeclineHelpWiring.test.ts` fails if the
claim returns.

**AND THE ONE ACCURATE WARNING WAS HIDDEN IN THE CASE THAT FAILS.** The
confirm-sheet bullet naming this exact refusal was gated on `!rawIntact` — true
only when the scan had been EDITED. The measured failure is an UNTOUCHED
merchant scan, so the advice was suppressed precisely where it was needed. The
decline panel below it was worse than absent: it explained the problem as
person-to-person only and closed with "Shop QRs scanned with ONIQ … are
unaffected", which tells the person the panel does not apply on the one screen
where it does, and sends them away from the route that works.

**THE MUTATION TEST CAUGHT ITS OWN TEST NOT TESTING.** The first assertion
against re-gating passed while the gate was mutated back in — it compared the
wrong slice. Rewritten to find the `<li>` the decline text lives in and assert
what precedes that tag does not end in `&& (`, which is the exact shape of the
bug; both mutations now fail. This is the third time in two days a green
assertion in this repo turned out to be asserting nothing.

WHAT IS NOW TRUE, stated as measured and no wider: **PhonePe, one handset, one
merchant QR.** GPay and Paytm have NOT been tried through ONIQ, and no claim is
made about them. Whether this is a policy, an allowlist or something about this
merchant cannot be established from here — only that the hand-off declined and
the native scan did not.

**WHAT THIS MEANS FOR RAIL B IS THE OWNER'S CALL, NOT AN ENGINEERING ONE.**
`marketingCopy.ts` promises "Scan any UPI QR and pay from your own GPay, PhonePe
or Paytm", and on the one merchant QR anyone has tested that is false. Changing
what ONIQ advertises is a user-visible policy change, so it is asked rather than
edited. What WAS done needs no permission under any answer: the failure path now
leads with the step that was measured to work.

### 2026-09-06 (later) — ALL THREE UPI APPS REFUSE. Rail B does not complete a merchant payment.

Owner: _"all failed"_. The remaining two were tried on the same QR and the same
handset, so the finding is no longer about one vendor:

    PhonePe  -> DECLINED     Google Pay -> DECLINED     Paytm -> DECLINED
    the same QR scanned inside the app itself -> SUCCEEDED

That is EVERY app ONIQ can target. Combined with Test 1 — the QR's own bytes,
zero transformation, also declined — **the `upi://` hand-off completes no
merchant payment from ONIQ**, and there is no string, scheme or field ordering
left to try. Scan & Pay reads a QR correctly and cannot pay with it.

Stated no wider than measured, and this is the discipline that matters here:
ONE handset, ONE merchant QR. Whether this is a rule the apps now enforce, an
allowlist ONIQ is not on, or something about this payer or payee **cannot be
established from this container**, and guessing which is what cost two days.

**THE OWNER CHOSE "LEAVE IT AS SHIPPED" WHEN THE EVIDENCE WAS ONE APP.** That
answer is recorded as given and has NOT been overridden — the hand-off is still
offered, and the decline panel still names the route that works. The premise it
rested on ("PhonePe refuses, the others are untested") is gone, so the choice
was put back to the owner rather than re-decided here. Until they say otherwise,
every merchant payment through Scan & Pay begins with a failure.

WHAT WAS CHANGED WITHOUT ASKING, because all of it is truth-keeping rather than
product:

- The stale caveat **"GPay and Paytm have NOT been tried through ONIQ"** is
  gone from `miniapps.ts` and `appRegistry.ts`. It was accurate for about an
  hour. A caveat that outlives its measurement is exactly what produced
  "merchant intents are unaffected", the sentence that misdirected this whole
  investigation — so it gets corrected the moment the measurement lands.
- The decline panel said "a UPI app can refuse"; it now names all three.

WHAT THE OWNER DIRECTED, 2026-09-06 — **soften the marketing claim**:

    site card   "Scan any UPI QR and pay from your own GPay, PhonePe or Paytm."
             -> "Scan any UPI QR and open it in your own GPay, PhonePe or Paytm."
    Home tile   "Scan any UPI QR, pay from your own app"
             -> "Scan any UPI QR, open it in your own app"

`pay from` asserted a completed payment. `open it in` claims only the part ONIQ
performs — read the code, hand it over. The Play declaration went the same way,
`"UPI scan-and-pay"` -> `"UPI QR scanning, handed off to the user's own payment
apps"`: claiming LESS capability on a Play form is always the safe direction and
is now also the accurate one. `marketingCopy.test.ts` pins the card's TITLE and
its live/hidden agreement with `appRegistry`, neither of which moved.

`upiDeclineHelpWiring.test.ts` pins the wording against `pay from` returning,
mutation-checked. It pins the PHRASE rather than the sentiment, because that is
the exact phrase that was false and the one an editor reaches for.

**DO NOT DECLARE THIS FIXED.** Nothing here fixes it — the fix, if there is
one, is a different architecture and a business decision. Rail A (Razorpay) is
untouched by any of this and must stay that way; `sign` is never weakened,
regenerated or stripped.

### Owner directive, 2026-09-06 (evening) — "hide upi"

Reverses that morning's "make upi active again". The flag has now moved FOUR
times (visible -> hidden 2026-08-17 -> visible 2026-09-06 -> hidden), and the
reason this time is measured rather than aesthetic: all three UPI apps declined
the hand-off, including on the QR's own untransformed bytes.

**HIDDEN IS NOT DELETED.** `/app/upi` and `/app/scan` still resolve, so a
bookmark, a deep link or a chat attachment still works, the anti-fraud UX is
intact, and a fifth flip is a flag rather than a rebuild.

**THERE ARE SIX DOORS, ACROSS FOUR FILES, AND THE MORNING PROVED THAT MISSING
ONE IS THE DEFAULT OUTCOME.** Unhiding the registry entry alone lit only the
shortcut buried inside Plug, three taps down a directory, while Home had no tile
and `worlds.test.ts` forbade adding one — "active" and unreachable, reported as
_"no tabs, no icons"_. Hiding has the mirror-image failure: shut four, miss the
fifth, and the feature is "hidden" behind a link that still opens it.

    1  registry entry            appRegistry.ts      hidden: true
    2  Plug shortcut             app.miniapps.tsx    derived from 1
    3  mini-apps directory       appRegistry.ts      derived from 1
    4  Home tile                 worlds.ts           removed
    5  site card                 marketingCopy.ts    removed
    6  Play capability line      playCompliance.ts   removed

Doors 2 and 3 are DERIVED, not declared, so they closed for free — and that is
exactly why `src/data/__tests__/upiDoors.test.ts` EVALUATES the app's own
expressions rather than greping. A future edit replacing `!UPI_ENTRY.hidden`
with a literal would pass any text search while reopening the door.
Mutation-checked one door at a time: unhiding the entry fails 4 assertions, the
Home tile 1, the site card 2, the Play line 1.

The Scan & Pay card is REMOVED rather than marked `soon`, because `soon` is
false in the other direction — the screen exists and works; the hand-off is what
fails. `CardStatus` has two values by design and absent is the honest third.

**AND A COMMENT PUSHED A FLAG OUT OF A TEST'S FRAME.** `marketingCopy.test.ts`
read the registry entry as a fixed 400-character slice. Writing the directive
above `hidden: true` moved it to offset 1,193, so the slice never saw it and the
test reported "site and app disagree" while they agreed perfectly — which reads
as "your site edit was wrong" and invites reverting the correct half. Two fixes,
because either alone is luck: the flag now sits immediately under `id`, and the
slice runs to the entry's closing brace instead of a magic number. Verified by
mutation — with the flag pushed back to offset 1,867 the test still passes.

**Where a test reads source by offset, a comment is executable.**

### Owner directive, 2026-09-06 — "give delete option in create across all four"

Films already had one (`delete_story_job`, with a confirm, in `YourVideos`).
Pictures, songs and voice clips did not. All four now have it on
`/app/creations`, through one client helper, `src/lib/deleteCreation.ts`.

**THE OBVIOUS IMPLEMENTATION IS A SPEND HOLE, and it is not visible from the
delete code.** `image_jobs`, `music_jobs` and `voice_jobs` ARE the daily-cap
ledgers. Each generate function counts rows in its own table over a rolling
24h TWICE — once for the house cap, once per user — and **neither count
filters on `status`**. So a hard `DELETE` would let any signed-in person reset
their own cap AND THE HOUSE CAP by deleting in a loop: unmetered generation on
the owner's metered Google key, for the price of a delete.

Both halves of the answer were already written down by people who had hit it:
each table's own comment says _"a failed attempt that cost money is still
recorded rather than vanishing"_, and `delete_story_job` says a delete _"could
delete the record of what it was charged"_. The row is a receipt.

So delete MARKS and removes bytes:

    status = "deleted", stored_path = null    the row, and the charge, stand
    storage.remove([path])                    the content really goes

`status = "deleted"` needs NO migration and hides it everywhere for free — the
`list` action already filters `.eq("status", "done")`. Ordering is row-first:
if the byte removal then fails the object is orphaned in a private bucket,
invisible and unreachable, which beats the reverse failure of bytes gone while
the row still lists a 404ing item.

**THE OWNERSHIP FILTER IS THE WHOLE AUTHORIZATION.** These functions use the
service-role `admin` client, which bypasses RLS, so `.eq("user_id", user.id)`
on BOTH the read and the update is the only thing standing between a caller
and anyone else's creation. "Not yours" and "not there" return the same 404 so
the endpoint cannot be used to probe ids.

**DELETE SITS ABOVE THE SPEND GATES**, with `list`. A person at their daily cap
must still be able to remove what they made; below the gates it would mean
"you are out of generations, so you may not tidy up".

`src/lib/__tests__/deleteCreation.test.ts` pins all of it, mutation-checked
four ways on the server (hard DELETE, dropped user filter, a cap count that
starts filtering `status`, and byte removal removed — each fails) and two ways
on the UI (audio card hard-coding "song", film card losing its control).

**AND TWO OF ITS OWN ASSERTIONS FIRST MATCHED PROSE, NOT CODE.** Counting
`.eq("user_id", user.id)` over raw source found three, because the block's
comment EXPLAINS the filter by quoting it; and the gate-ordering check matched
the phrase "daily cap" in the file's header comment, hundreds of lines above
the real gate. Both now strip comments first, and the gate is located by its
effect (`return json(429`) rather than by any wording. This is the second time
in two days a source-reading assertion in this repo turned out to be asserting
about the documentation.

**ORDERING FOR THE SHIP, because edge functions do not deploy with a web
publish.** The delete action is purely additive — no existing client sends it —
so the functions go FIRST and the web publish second. Checked rather than
assumed: an OLD deployed function receiving `action: "delete"` falls past
`list`, past the gates, into validation, finds no prompt and returns 400. No
generation, no spend; the button simply reports it could not delete.

### Owner directive, 2026-09-06 — a picture in a film, and the Vertex 403

Two reports: _"user can't create music in their own voice"_ and _"image not
used in making video"_. Neither was a bug; both were things never built.

**A FILM TOOK NO PICTURE AT ALL.** `StoryWriter` is a text box, and
`OniqAttachImage` appears in exactly two files — Music and Image. Asked what a
picture should DO, the owner chose **character reference — a face that
recurs**, so a photo now becomes a saved character's reference portrait.

It rides the EXISTING save path: same bucket, same `save_story_actor`, same
24-portrait cap. It also costs LESS than the feature beside it — drawing spends
an image credit, choosing a photo spends nothing.

**THE COLUMN WAS ALREADY THERE, SHUT.** `story_actor_assets.source` was created
2026-08-27 as `default 'generated' check (source = 'generated')` — someone saw
this coming and left the shape without opening it. So the migration widens a
check rather than adding a concept, and it DROPS the 5-argument
`save_story_actor` when adding the 6th: a defaulted parameter makes a second
signature, and a 5-argument call would then be ambiguous — failing in
production at call time rather than at deploy.

**THE LABEL FOLLOWS THE ORIGIN, and this is the part that matters for Play.** A
drawn portrait is AI-generated content ONIQ must label; a photo the person took
is NOT, and calling it "AI-generated" is a false claim pointing the other way.
The alt text reads the column, an unknown source is treated as AI (over-label,
never under-label), and the "Save again" retry carries the origin so it cannot
quietly relabel a photo.

**TWO REPO GUARDS CAUGHT REAL FAULTS IN THE FIRST DRAFT**, and both were right:

- `react-hooks/rules-of-hooks` refused `usePhoto` — a `use` prefix reads as a
  hook and cannot be called from an onChange. Renamed `attachPhoto`.
- `megaLoopGuardrails` refused `.arrayBuffer()`: whole-file reads are banned on
  upload paths with a frozen tail of exactly five, and nothing may join it. The
  fix was better than the rule required — a picked photo is already a Blob and
  Supabase's upload takes one, so the bytes stream to storage and are never
  materialised. Only a 12-byte head is read, through a stream reader, because
  `slice(0,12).arrayBuffer()` is bounded and still the banned shape.

**AND A SOURCE-READING ASSERTION MATCHED PROSE FOR THE THIRD TIME TODAY.** The
UPI decline test counted an ownership filter its own comment quoted; the delete
test found a spend gate by a phrase in a file header; this one banned
`.arrayBuffer()` while the comment explaining why it was avoided says
`.arrayBuffer()`. The pattern is structural, not careless: good comments quote
the code they discuss, so any grep strict enough to be useful will hit them.
**Where a test reads source structurally, strip the comments first.**

### 2026-09-06 — the voice-clone blocker MOVED, measured on the owner's route

Owner, asked how to handle singing in your own voice: _"Use vertex api through
firebase"_ — which is already the configured route (directive 2026-09-04e).
So it was measured rather than argued, with the Firebase service account:

    GET aiplatform.googleapis.com/v1beta1/projects/oniq-309bd/locations/global/voices
        Authorization: Bearer <OAuth2 from FIREBASE_SERVICE_ACCOUNT>
    -> HTTP 403 PERMISSION_DENIED
       aiplatform.voices.list denied on projects/oniq-309bd/locations/global

**THE ERROR ADVANCED, which is the signal.** It was `401 UNAUTHENTICATED /
CREDENTIALS_MISSING` on 2026-09-04. A 403 naming a specific IAM permission
means the credential is now ACCEPTED and the block is authorization — the same
shape as the SMS region policy, where reading only the status code would have
missed the change.

`aiplatform.voices.list` is an IAM permission, so the likeliest next step is
granting the service account a Vertex AI role on `oniq-309bd` — an owner action
in the Cloud console, not a preview form. That is a HYPOTHESIS: an allowlist
refusal can also surface as 403, and only re-running the probe after the grant
distinguishes them.

**AND "ADMISSION IS THE ONLY THING LEFT" WAS ALREADY WRONG** — corrected in the
capability row the same day. No deployed function imports
`_shared/voiceReplication.ts` (grep returns 0) and `voice-generate` can only
ask for `prebuiltVoiceConfig.voiceName`. Built and unit-tested is not
reachable.

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

### 2026-09-06 — the voice-clone blocker was never only Google's. It was ours.

The owner, after a day of Vertex probing: _"We have already proved that Firebase
can be used for vertex AI... everything is done in the Firebase and in the
cloud. Fix it."_ They were right to stop it, and the honest answer to "what is
the problem you are facing right now?" was not a Google one.

**NOTHING IN THE DEPLOYED APP CALLED THE FEATURE.** `_shared/voiceReplication.ts`
has been complete since 2026-09-04 — consent scripts, WAV rules, both request
bodies, key reader, expiry rule, all unit-tested — and a grep for it across
`supabase/functions/*/index.ts` returned **0 importers**. `voice-generate`'s only
voice field is `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`: a
built-in Google voice, with no branch that could carry a minted key. This was
already written down in the `voice.clone` capability row and in
`capabilityRegistry.test.ts`, which asserted the gap deliberately so it would go
red the day someone closed it. **It was read as a footnote to the Google story
instead of as the other half of it.**

**AND EVERY PROBE USED THE WRONG VERB.** Each measurement of the "blocker" — the
401 on 2026-09-04, the 403 on 2026-09-06, and the read-only probe added to
`firebase-provisioning` the same evening — was a **GET** of
`.../locations/global/voices`. That is a LIST. Minting is a **POST to the same
path** and needs a different permission, so not one probe ever exercised the
call the feature makes. This file's own first rule, written months earlier:

> **Verify a model id by POST before writing it into code.** Not by ListModels
> — a catalogue says what exists; only a POST says what this key may call.

Three sessions read that rule and then measured a catalogue. The GET probe is
kept (it is still the cheapest signal that a grant landed) but it is now
labelled as what it is, and `voice-clone`'s `create` is the first POST anyone
has made to that endpoint.

WHAT WAS BUILT, `supabase/functions/voice-clone`:

    script   the consent sentence, free, ABOVE every gate — it is needed
             before a recording exists. Refuses the five languages whose
             scripts arrived corrupted rather than handing over a sentence
             that cannot match Google's word-for-word check.
    create   both recordings validated BEFORE the billable POST, then
             replicationKeyBody -> voicesUrl -> readReplicationKey -> stored
    speak    replicatedSpeechBody with the stored key; PCM wrapped, signed URL
    list     the caller's live voices, expiry via keyExpired
    delete   marks the row and NULLS the key

**ADMIN-ONLY, AND THAT IS A SPEND DECISION NOT A CAUTION.** Vertex replication
bills the METERED Google key, not Lovable credits. Who may mint, how many a day
and at what price are the owner's under this file's first rule, so the gate is
`is_admin` and the caps are floors rather than policy until the owner sets them.
The gate sits ABOVE the first line that can spend, and that ordering is pinned.

**`voice_clones` IS THE CAP LEDGER, so delete marks and nulls the key.** The
rolling-24h counts do not filter on `status` — the same shape as `image_jobs`,
`music_jobs` and `voice_jobs` — so a hard `DELETE` would buy unmetered mints on
the owner's key for the price of a delete. RLS gives a person `select` on their
own rows and **no write at all**; every write is the service role, because a
client that could insert here could name any voice key it liked, including one
minted from somebody else's recording.

**THE GUARD WENT RED ON CUE, THEN RED FOR THE WRONG REASON.** `grep -rl
voiceReplication` also matched `firebase-provisioning`, whose only mention is a
COMMENT saying nothing imports it — **the fourth prose match in this repo in two
days.** Good comments quote the code they discuss, so any grep strict enough to
be useful will hit them. It searches import statements now. The assertion is
inverted rather than deleted, and four new ones are mutation-checked: POST→GET,
the gate sinking below the credential, a hard delete, and the import removed.

**LIVE AND VERIFIED, 2026-09-06.** `main` at `299a2d77`, migration applied,
`voice-clone` deployed, web published, and the served ROUTE chunk checked —
not the entry, because all four markers live in the route chunk and greping
`index-*.js` would come back clean and read as a stale deploy:

    https://oniqhub.com
      entry   assets/index-BV-CTaHT.js
      chunk   app.admin.firebase-NkQwgG4l.js   2,997 bytes
        voice-clone-probe   1     Asking Vertex               1
        Voice replication   1     firebase-provisioning-run   1
      POST /functions/v1/voice-clone with no JWT  ->  401

**AND THE LOVABLE AGENT CAUGHT SOMETHING WORTH CHECKING.** It flagged that the
migration carried no `GRANT`, its own rule being that a public-schema table
without one "will fail at runtime" — and it applied the file unchanged and said
so rather than silently editing it, which is the right order. Measured instead
of argued, with `voice_jobs` as the control:

    has_table_privilege('authenticated','public.voice_clones','SELECT')  t
    has_table_privilege('service_role','public.voice_clones','INSERT')   t
    has_table_privilege('authenticated','public.voice_jobs','SELECT')    t

Grants are present — this project's default privileges cover new public tables,
so the RLS policy is load-bearing rather than decorative. Recorded because the
flag was reasonable and the answer is not obvious from the file.

WHAT IS STILL UNKNOWN, stated as unknown: whether Google will mint. Replication
is an allowlisted preview, and a missing IAM role, an allowlist refusal and a
disabled API all arrive as **403 with only the text to separate them** — so the
mint passes Google's own words straight back to the caller. **The first real
POST is the measurement.** Do not record it as working until one returns a key.

### 2026-09-07 — "msg notification not coming when closed": measured, and one half fixed

Measured on production before touching anything, because the report has two
completely different causes depending on which direction the message went:

    device_tokens   android 46 rows / 25 users   web 2 rows / 2 users
    users signed in in the last 30 days: 37      (NOT 126 — that includes
                                                  dormant accounts, and the
                                                  first framing of this as
                                                  "25 of 126" was wrong)
    client_error_reports, surface='send-push', 30d
      "accepted but sent 0"  44   newest 2026-09-05 16:00
    8 of 19 active conversations have ZERO members with a token

**THE OWNER WAS THE RECIPIENT, NOT THE SENDER**, which inverted the search. The
only message in either of their recent conversations in three days:

    2026-09-06 19:31:38+00   sender: shrakes93

and the owner HAS a fresh token — android, registered 16:59 the same day, two
and a half hours earlier. So the "recipient has no push address" story, true of
8 conversations and of `shrakes93` themselves, is NOT the story here.

WHAT WAS RULED OUT BY READING, each of which was a plausible headline:

    the caller       7 sendPush call sites in the chat route — text, sticker,
                     media, location. It is wired.
    the payload      send-push attaches a `notification` block for
                     kind="message" (data-only is calls only), which is exactly
                     what the system tray needs when the app is killed
    the channel      MainActivity DOES create oniq_messages at startup — the
                     "created lazily in a foreground-only handler" theory was
                     checked before it was said, and it was wrong

**AND THE ONE REAL DEFECT FOUND: THE MESSAGE CHANNEL NEVER PEEKS.**

    oniq_calls     IMPORTANCE_HIGH     heads-up banner
    oniq_messages  IMPORTANCE_DEFAULT  shade only, no banner

A call pops up on screen and a message does not. To anyone who does not pull
the shade down that is indistinguishable from no notification.

**THE ONE-LINE VERSION OF THIS FIX DOES NOTHING, and that is the part worth
keeping.** Android LOCKS a channel's importance at creation — the app can never
raise it afterwards, and deleting the channel does not reset it, because
Android remembers a deleted channel's settings and restores them for the same
id. So editing `IMPORTANCE_DEFAULT` to `IMPORTANCE_HIGH` in place would have
compiled, shipped, passed review and left every existing install exactly as
quiet. A NEW ID is the only way to get a new importance. Hence
`oniq_messages_v2`, with the old one deleted so it does not sit in system
settings as a second dead "Messages" row.

`setPriority(PRIORITY_HIGH)` went on both message builders too: `minSdkVersion`
is 24 and channels only exist from 26, so on API 24-25 the channel importance
is ignored entirely and the builder priority is the only thing that produces a
heads-up. The group SUMMARY needs it as well — that is what a grouped pre-O
notification actually displays, so giving it only to the child would have left
the one notification an old phone shows as the silent one.

`src/lib/__tests__/pushChannel.test.ts` pins the three-way agreement —
MANIFEST `default_notification_channel_id` = `MainActivity.MSG_CHANNEL_ID` =
`OniqMessagingService.MSG_CHANNEL_ID` — because the app-is-closed route reads
the manifest and the foreground route reads the constant, so renaming one alone
breaks only the route you did not touch, in production, only for people whose
app is shut. Six assertions, all mutation-checked (manifest drift, the legacy
id coming back, the delete removed, either creation site back to DEFAULT, the
summary losing its priority). Comments stripped first — every one of them
quotes `IMPORTANCE_DEFAULT` and `oniq_messages`, which is the fifth prose match
in this repo in three days.

**THIS IS NATIVE CODE. IT NEEDS A PLAY RELEASE**, not a web publish — the
Capacitor shell is what holds the channel, so nothing reaches a handset until a
build ships.

**AND IT IS HALF AN ANSWER, STATED AS HALF.** It fixes "the notification never
pops up". It does NOT fix "no notification arrives at all", and which of those
happened on 2026-09-06 is still unmeasured: whether anything appeared in the
shade is a thing only the handset can say. `send-push`'s own edge logs came back
EMPTY for the whole window, which — by this file's oldest rule — answers
identically for "never invoked" and "not retained", so it is not evidence
either way. The controlled version costs one message: send one, then re-fetch
the logs immediately. If a line appears, logging works and the 19:31 send
genuinely never happened; if none does, the log pipeline is blind and cannot be
used as evidence at all.

**THE STRUCTURAL RISK BEHIND ALL OF IT, recorded and not acted on:** `sendPush`
is invoked from the SENDER's client. If that client never runs the line — a
closed tab, a dropped request, an early throw — no push exists and nothing
anywhere records that it did not happen, because `push.ts` writes a row only on
FAILURE. A server-side trigger on `messages` insert is the robust shape, and it
is a bigger change than this one.

### 2026-09-07 — "I asked you to give delete options in image, voice, and music. You didn't."

The owner was right, and on both halves.

**HALF ONE: THE CONTROL WAS BUILT ON A SCREEN NOTHING LINKS TO.** The delete
went on `/app/creations`. Its only inbound reference in the entire app is a
"back" link on a not-found page — measured, `grep -rn "app/creations"` returns
`routeTree.gen.ts` and `app.made.$kind.$id.tsx` and nothing else. So the control
existed, worked, was tested, and could not be reached by anyone who had not
typed the URL. The owner asked for delete "in image, voice and music" and got it
somewhere else.

**This is `upiDoors` again, from the other side.** That entry says a feature is
where its doors are, and the morning it records shipped "active and unreachable"
— reported as _"no tabs, no icons"_. The same mistake was made three weeks later
by the agent that wrote it down. **Reading a lesson is not applying it: before
calling a UI change done, grep for what LINKS to the screen it lives on.**

All three Create screens already list what you made — `app.image`, `app.music`
and `app.voice` each call `action: "list"` and render a card per row — so the
delete belongs on those cards, beside the Open link. `OniqDeleteCreation` is one
component owning its own arm/confirm/busy/error state; the `/app/creations`
version threaded four pieces of parent state per card, and repeating that three
more times is four places for the confirm step to drift. The row leaves the list
only when the server agrees — an optimistic removal would show the thing gone
while it is still there and reappearing on the next load.

**HALF TWO: THE EDGE FUNCTIONS WERE NEVER DEPLOYED.** The `action: "delete"`
branch went onto `main` with this file's own ordering note beside it — "edge
functions do not deploy with a web publish, so the functions go FIRST and the
web publish second" — and then only `firebase-provisioning` and `voice-clone`
were deployed. `image-generate`, `music-generate` and `voice-generate` were not.
So the buttons on `/app/creations` were live in the shipped bundle with nothing
behind them: every tap would fall past `list`, past the gates, into validation,
find no prompt and return 400. **The ordering note was written and then not
followed in the same session.**

LIVE AND VERIFIED, `main` at `51ccd0a5`:

    supabase--deploy_edge_functions ["image-generate","music-generate","voice-generate"]
      -> deployed

    entry  assets/index-DIaw4enL.js        (was index-BV-CTaHT.js)
      app.image-u7aQwg-z.js  7,466  image-picture-delete = 1
      app.music-Bg5NwiOx.js  6,976  music-song-delete    = 1
      app.voice-ByHXgRk9.js  7,955  voice-clip-delete    = 1
      app.creations-CYLfx3Du.js (was CWDj6v_G) all three markers = 1

Each marker lives in its OWN route chunk and none in the entry — learned from a
local build first, so the production check discovered each chunk from the entry
rather than guessing a name.

`src/lib/__tests__/createScreenDelete.test.ts` fails if any of the three screens
stops listing or loses its delete control, and pins that the row is removed only
on `res.ok`. Mutation-checked both ways.

### 2026-09-07 — "firebase tab opens to nothing". The three admin tools had never rendered.

Reported the morning after their links shipped. The link worked, the route file
was correct, the chunk was served, the edge function was deployed — and the
screen had never once appeared, for anyone, since the day each was written.

**TanStack's flat file convention NESTS BY DOTS, and a child renders only
inside its parent's `<Outlet />`.** `app.admin.firebase.tsx` was a CHILD of
`app.admin.tsx`. `app.admin.tsx` is the Moderation inbox — a leaf screen with
no Outlet. So `/app/admin/firebase` mounted the INBOX and dropped the tool
silently. All three tools, the same way:

    app.admin.firebase     -> parent app.admin   NO OUTLET
    app.admin.gpu-video    -> parent app.admin   NO OUTLET
    app.admin.video        -> parent app.admin   NO OUTLET
    42 other nested pairs  -> parent has Outlet  fine

Forty-two other pairs pass, so this is not a heuristic firing on everything —
it is three files, and they are exactly the three that were reported broken.

**THE CHUNK CHECK IS THE ONE THAT LIED, AND IT IS THE ONE THIS FILE
PRESCRIBES.** Recorded above, 2026-09-05, in these words: _"The SCREEN is live
too, which is a separate fact from the function being deployed and from the
code being on `main` — verified against the shipped bundle."_ That verification
found the route path in the entry chunk and the button's marker in its own
route chunk, and concluded the screen was live. **A route chunk ships whether
or not anything mounts it.** `oniq-ship` names three claims — the asset is
reachable, the bundle references it, the page renders it — and says none
implies the next. This conflated the first two with the third and then wrote
the conclusion down, where two later sessions read it as settled.

Nothing else could have caught it either, and that is worth listing because
each of these felt like coverage:

    tsc                       clean — a route typechecks either way
    4,900 tests               green
    adminDoors.test.ts        green — it asserts a LINK EXISTS, which it did
    the served chunk grep     green — the chunk is fetched and parsed; the
                                      component is simply never called
    POST the edge function    401  — the server was always fine

**AND IT MADE THE PREVIOUS DAY'S DIAGNOSIS WRONG IN THE OTHER DIRECTION.**
"admin features not showing in id" was read as three routes with no doors, and
links were shipped. The links were genuinely missing and are genuinely needed —
but the report was about the tools not working, and adding a door to a room
that cannot be entered does not open it. Both halves were real; only the second
one was the complaint.

FIXED by opting the three out of nesting — `app.admin_.firebase.tsx`, the
trailing underscore on the PARENT segment, which changes the route id and
leaves the URL alone. `/app/admin/firebase` still resolves; it is now a child
of `app` (which has an Outlet) rather than of `app.admin` (which does not).
Giving `app.admin.tsx` an Outlet instead would have drawn the whole Moderation
inbox above every tool, so the underscore is the right half of the fix rather
than the lazy one. The filename is load-bearing and says so where it is read
from — `playCompliance.ts` names two of these files by path.

`src/lib/__tests__/routeNesting.test.ts` is the guard, and it is APP-WIDE
rather than a fourth admin special case: for every route file whose dot-parent
exists as a file, that parent must render an `<Outlet />`. Comments are
stripped first — `app.admin.tsx` may one day explain in prose why it has no
Outlet, and a guard that read the explanation as the code would pass on the
very file it exists to catch. **That is the sixth prose match in this repo in
four days.** Mutation-checked both ways: re-nesting one file fails two
assertions, and a prose `<Outlet />` in the parent does not rescue it.

**LIVE AND VERIFIED, 2026-09-07.** `main` at `f287b7dc`, published, and the
served chunk checked:

    https://oniqhub.com
      entry   assets/index-DQzpV2Jn.js            (was index-qEkxEdxv.js)
      chunk   app.admin_.firebase-BEJXK6Vz.js     2,997 bytes
        voice-clone-probe   1     Voice replication          1
        firebase-provisioning-run 1

**THE FILENAME IS THE EVIDENCE HERE, and that is better than any grep.** The
underscore in `app.admin_.firebase-*.js` IS the route id, so a chunk that
carries it cannot be the nested build. Compare the marker counts: identical to
the ones recorded for `app.admin.firebase-NkQwgG4l.js` on 2026-09-06, at the
identical 2,997 bytes — the component source never changed, so every content
grep answers the same before and after. Only the NAME distinguishes the broken
build from the fixed one, and only the hash moving (`NkQwgG4l` -> `BEJXK6Vz`)
proves the module id changed at all. **When a fix changes structure rather than
source, pick a marker that structure moves.**

**THE SEQUENCE THAT FOUND IT IS THE REUSABLE PART.** The owner said the tab
"opens to nothing". Before touching anything, the DATABASE was measured —
`profiles.is_admin` true for the owner, `public.is_admin` SECURITY DEFINER with
`authenticated` holding EXECUTE, and the function run as `role=authenticated`
with that user's JWT claims returning **true**. That killed every server-side
theory in one query and left only the client. Then the nesting was ENUMERATED
across all 45 pairs rather than inspected for the one file in question, which
is what turned "the firebase screen is broken" into "these three are, and only
these three".

### 2026-09-07 — the first real POST to Vertex answered, and the probe ate the answer

The owner tapped Voice replication. The first POST anyone has ever made to that
endpoint returned:

    {"project":"oniq-309bd","authMode":"service-account","status":404,
     "detail":"http 404","verdict":"UNEXPECTED 404 — read the detail"}

**"Read the detail", and the detail was the status restated.** The one thing
that probe was built to deliver — Google's own words, because a bare status
cannot separate a missing IAM role from an allowlist refusal from a disabled
API — is the one thing it dropped.

**WHY, measured the same hour with four unauthenticated curls and no credential
at all.** `aiplatform` answers this endpoint with a JSON **ARRAY** wrapping the
error object:

    [{"error":{"code":401,"status":"UNAUTHENTICATED","message":"Request is
      missing required authentication credential. …"}}]

`vertexPost` read `parsed?.error`, which is `undefined` on an array. Both fields
came back empty, the join produced `""`, and `|| \`http ${status}\``turned a
real sentence into a placeholder.`firebase-provisioning`'s `get` had the
identical blind spot and would have reported an error object holding two
undefineds — so the probe this file tells you to reach for FIRST was equally
blind.

**AND THE SAME FREE RUN SETTLES WHAT THE 404 IS NOT**, which is worth more than
the fix. Both wrong-path shapes were reproduced, and neither is JSON:

    POST v1beta1 …/locations/global/voices        401  JSON, proper error shape
    POST v1      …/locations/global/voices        404  EMPTY body
    POST v1beta1 …/locations/global/models        404  Google's HTML page
    POST us-central1 …/locations/us-central1/voices 401 JSON

ONIQ's URL reaches the AUTH CHECK unauthenticated, so the route resolves and
POST is a defined method on it — the URL is right. And a 404 whose body PARSED
as JSON cannot be either wrong-path shape, because neither of those parses. So
the 404 the service account met is an application-level refusal **with words
attached**, and those words are what the next tap will print.

**An unauthenticated request is a free path-existence probe: 401 means the route
resolves, 404 means it does not.** No credential, no spend, and it distinguishes
"wrong URL" from "refused" without asking anyone for anything. Reach for it
before theorising about a 404.

FIXED by `supabase/functions/_shared/vertexError.ts`, one reader used by both
functions. It unwraps the array, accepts `error` as a bare string, and — the
part that matters — **falls back to the RAW BODY, never to the status.** An
unreadable sentence can still be read by a person; `http 404` cannot be read by
anyone. `src/lib/__tests__/vertexErrorDetail.test.ts` runs the verbatim measured
bodies, mutation-checked twice: the old inline reader fails the array case, and
removing the raw-body fallback alone fails the unknown-shape case.

**THE RULE: a diagnostic may never fall back to the thing it was built to
explain.** That is the same failure as `auth/internal-error` hiding
`customData.serverResponse`, three sections up — a catch-all standing in for the
sentence underneath it — and it cost the same thing: a round trip that returned
nothing.

**DO NOT READ THE 404 AS AN ANSWER YET.** Whether Vertex voice replication is
allowlisted for `oniq-309bd` is still unknown, and this file's rule holds: the
first POST that returns a key is the measurement. What changed is that the next
one will say why if it does not.

#### Asking for a deploy "at commit X" is what stalled it

The deploy of `voice-clone` and `firebase-provisioning` did not happen, and the
first cause was the wording of the request, not the credits that closed behind
it. Sent as "Deploy two edge functions at commit 95578c2e", the Lovable agent
did exactly the right thing:

    git rev-parse HEAD  ->  e29c2dfce27f2243feb3a5eaa77de91fc3465330
    "HEAD mismatch — cannot deploy as requested. I am not allowed to run
     git checkout to switch commits."

It was correct twice over: stateful git is forbidden on its side, and it cannot
know from a bare sha whether HEAD CONTAINS that commit. `e29c2dfc` is
`95578c2e` plus fourteen lines of this file — the deploy was always safe — but
nothing in the message said so.

**NAME THE STATE, NOT THE COMMIT.** The other agent deploys its working tree; a
sha it cannot check out is an instruction it can only refuse. Verify the
containment here (`git merge-base --is-ancestor`, plus the diff being
code-free), then ask for the tree it already has and give it a one-line check
it can run itself — `grep -c vertexErrorDetail` on the two files, stop if zero.
That turns a refusal into a deploy with the same safety.

The round trip cost more than a round trip: the clarification was refused with
`"Your workspace is out of credits"`, so the corrected instruction never
arrived. **A wasted turn is not always recoverable — the window can shut.**

**AND THE SUPABASE MCP IS NOT THE WAY AROUND IT.** It is the only other tool
here with `deploy_edge_function`, and it points at `nzbthoecadcwdoqxhaok` —
not production. Deploying there would put the function in a project nothing
calls, which is the trap recorded in full further up this file. Blocked is
blocked; the fix waits for credits.

**AND NEITHER IS GITHUB — the blocker is credential OWNERSHIP, not tooling.**
Asked whether the deploy could go through CI instead, and measured rather than
reasoned, because the mechanism plainly exists: `supabase/setup-cli` plus
`supabase functions deploy <name> --project-ref bqwttemnnoexadpwifcj` is an
ordinary workflow. What it needs is `SUPABASE_ACCESS_TOKEN`, an `sbp_`
MANAGEMENT PAT, because edge-function deploy is a CONTROL-plane call to
`api.supabase.com` — the same plane that answered the service role
`401 {"message":"JWT failed verification"}` further up this file. A service
role cannot deploy a function, and a service role is what GitHub holds.

Measured 2026-09-07 on the OWNER'S OWN Supabase credential, which is the fact
this file had recorded and never verified:

    list_organizations -> 1   xupsgjbkmjqftljaokhh  "siddharthamondal1002-droid's Org"
    list_projects      -> 1   nzbthoecadcwdoqxhaok  "oniq-sparkle-pay"  ap-northeast-2

**Production `bqwttemnnoexadpwifcj` is not in that list.** A PAT is minted per
ACCOUNT and inherits that account's org membership, so a PAT the owner creates
reaches exactly one project — the WRONG one. A CI deploy built on it would
succeed, go green, and put `voice-clone` in a project nothing calls: the
two-projects trap, with a passing workflow on top of it.

**AND THAT TRAP HAS ALREADY BITTEN THIS REPO IN GITHUB ACTIONS.** The comment
beside `SUPABASE_URL` in `story-worker.yml` records it in its own words —
_"every dispatch died on a gateway 404 because this secret named a different
project"_ — which is why the dispatch payload now carries the address and the
repository secret is only a fallback. The workflow's own design note is
_"no Supabase key ever reaches GitHub"_, and `SUPABASE_SERVICE_ROLE_KEY` is
expected ABSENT. Adding an account-wide PAT to that repo would reverse a
deliberate choice, not extend one.

So GitHub RELOCATES the blocker rather than clearing it. Two things clear it,
cheapest first: top up Lovable credits and send one message naming the STATE
(above); or be added to the Supabase organisation that actually holds
`bqwttemnnoexadpwifcj`, which is Lovable's, not the owner's — and that is a
business decision, since a PAT is account-wide and can delete projects.

**Nothing user-facing is waiting on this.** `voice-clone` is deployed and
admin-only; what is undeployed is `vertexErrorDetail`, a DIAGNOSTIC. The cost
of waiting is that the next Voice replication tap prints `http 404` again
instead of Google's sentence. Do not trade a control-plane credential for it.

### Owner directive, 2026-09-07 — "deploy through lovable but hard cap the credits to lovable"

DEPLOYED the same hour. One message, named by STATE rather than by commit,
and it cost **0.7 credits**:

    Lovable latest_commit_sha        4b03d417  == HEAD here, so "your current
                                               working tree" was the state to name
    grep -c vertexErrorDetail        voice-clone 2   firebase-provisioning 2
    supabase--deploy_edge_functions  ["voice-clone","firebase-provisioning"]
      -> Successfully deployed edge functions: voice-clone, firebase-provisioning
    response.cost_credits            0.7       (period 244 / 2000, Aug 18 – Sep 18)

**THE HARD CAP THIS SIDE CAN ENFORCE IS A MESSAGE COUNT, AND IT WAS ONE.**
Lovable bills per agent turn, so every turn spent diagnosing is a turn the
owner pays for — the CSP day above burned credits on six hypotheses. The cap
is therefore procedural: verify everything verifiable HERE first (containment
by `merge-base`, a code-free diff, the reader present in both files, the synced
sha equal to HEAD), send ONE message with the ask first and the limits
explicit, and never send a second to verify what a free action verifies. The
functional check — the next Voice replication tap printing Google's sentence
instead of `http 404` — costs zero credits, so it is the owner's tap, not a
message.

**THE PER-TURN COST IS ON THE MESSAGE OBJECT, NOT AVAILABLE TO THE AGENT.**
Asked to state what the turn cost, the agent could reach only
`credits--get_my_usage`, which is period-level, and said so rather than
guessing. The number that answers the question is `response.cost_credits` on
the `get_message` result — read it from here; asking the agent costs a turn
and returns a period total.

**A PLATFORM-ENFORCED CAP IS THE OWNER'S TO SET.** Lovable has a workspace
spend limit that pauses the agent at `awaiting_input` (a "credit check-in")
when reached; no MCP tool here sets it. And `get_workspace` returns plan and
member count with NO credit balance, despite its own description promising
one — so the balance is not readable from this side either. The agent's
period figure above is the only reading.

The 60-second client timeout fired on the send, exactly as `oniq-ship`
records. The message was queued (`accepted` 17:09:46Z), `get_message` showed
`running`, and it completed within three minutes. Resending would have doubled
the spend and put two agents in the tree. Poll, never resend.

### 2026-09-07 — the deploy verified by the owner's tap, and Google's sentence read

The owner tapped Voice replication. `detail` now carries Google's words:

    {"project":"oniq-309bd","authMode":"service-account","status":404,
     "detail":"NOT_FOUND: Method not found.","verdict":"UNEXPECTED 404 — read the detail"}

So `vertexErrorDetail` is live and the deploy is verified — by the thing it was
built to deliver arriving, not by a deploy tool saying "success".

**AND THE RULE WRITTEN THE DAY BEFORE IS WRONG, measured on the same URL.**
"An unauthenticated request is a free path-existence probe: 401 means the route
resolves" — the unauthenticated POST to `.../locations/global/voices` did
answer 401, and that was read as "POST is a defined method on it". With a
credential the identical URL answers `404 Method not found`. A 401 proves the
PATH PATTERN reaches the service's auth layer; it says nothing about whether
the VERB has a method bound. The free probe still separates a wrong host or
version (HTML or empty 404) from a known resource, and that is all it
separates.

**"METHOD NOT FOUND" IS NOT A PERMISSION REFUSAL.** The GET of this path got
`403 PERMISSION_DENIED aiplatform.voices.list` — IAM evaluated a named
permission, so `list` is a bound method this project is merely not allowed to
call. The POST reached no IAM check at all: nothing is bound to it. Google
answers 404 for a method a caller is not entitled to SEE, which is how
allowlisted previews are kept un-enumerable — so the text alone cannot separate
"hidden from this project" from "not the endpoint".

MEASURED against Google's own catalogue, free, no credential — the discovery
documents for `aiplatform` v1beta1 and v1, revision 20260831:

    methods whose path or name contains "voices"                0  (both versions)
    strings matching aiplatform.voices.*                        0
    schema GoogleCloudAiplatformV1beta1ReplicatedVoiceConfig    PRESENT
      .voiceSampleAudio  string   "The sample of the custom voice."
      .mimeType          string   audio/wav, 16-bit LE, 24 kHz
    VoiceConfig.replicatedVoiceConfig   "This enables users to replicate a
                                         voice from an audio sample."

So the PUBLIC API replicates a voice in ONE step — the WAV sample travels
inline in `generateContent`'s `speech_config.voice_config`, on the very URL
`replicatedSynthesisUrl` already builds. There is no key, no mint, no
seven-day expiry, and **no consent recording anywhere in the public schema**.
The two-step flow ONIQ built — mint a key at `POST .../voices` from a source
recording plus a word-matched consent recording, then speak with the key — is
the shape of the document the owner supplied on 2026-09-04d, and that document
described an allowlisted preview. Nothing in Google's public catalogue carries
it.

TWO READINGS, and this container cannot separate them:

1. **The `voices` surface is the allowlisted preview, hidden per-method.**
   `list` is visible enough to reach IAM, `create` is not. The fix is Google's
   access form — an owner action — and the code is right as built.
2. **The mint endpoint is not what this project's API serves**, and the
   one-step inline-sample shape is the current design. The fix is code: no
   mint, send the sample at speak time.

What separates them costs ONE Lovable message. The agent holds the service
account and has made authenticated Vertex calls before, so a single
`generateContent` POST with `replicatedVoiceConfig` carrying a three-second
synthetic 24 kHz WAV returns Google's sentence: audio, or a 400 about the
sample, means the one-step path is OPEN to this project; a 403, or a 400
naming a gate, means it is not. It is also separable by the owner saying
whether Google's access form was ever submitted or granted.

**READING 2 IS NOT AN ENGINEERING SWAP, which is why it is asked rather than
built.** The one-step shape needs the person's voice sample at every speak, so
ONIQ would have to RETAIN a recording — `voiceReplication.ts`'s header says in
capitals that it retains none, and `voice_clones` has no column for one. And it
carries no consent recording, so the word-for-word match this repo calls "the
product safety control, not a formality" would have no Google-side
counterpart: ONIQ could keep the consent step as its own policy but could not
verify it. Retaining a voice, and the consent rule, are user-visible policy —
the owner's line under this file's first rule.

**DO NOT BUILD READING 2 UNTIL IT IS MEASURED OPEN, and do not request the
allowlist for reading 1 on an agent's say-so.** Both are the owner's; the cheap
measurement is the one message above, and it was not sent — the owner had just
capped the credits, and a measurement that spends is asked for, not assumed.

### 2026-09-07 — "never": the form was not submitted, and the app said it was

Asked whether Google's access form was ever submitted for `oniq-309bd`:
_"never. no form was visible in the app also for user to declare."_

**THAT SETTLES THE ANOMALY.** A project that never asked for the allowlist is
exactly the project Google hides an allowlisted method from, so
`404 Method not found` on `POST .../voices` is the EXPECTED state under
reading 1, not a mystery — and reading 1 now needs no second assumption.
Reading 2 (the endpoint moved) is not excluded, only unnecessary.

**AND THE VOICE SCREEN HAD CLAIMED THE OPPOSITE SINCE 2026-09-04c.** The gate
under Create Voice read: _"Speaking in your own voice is a preview ONIQ has
asked to join."_ ONIQ had not asked. The registry evidence beneath it was
accurate the whole time — "only the owner can submit it" — and the screen
paraphrased it into a claim the evidence never made. Corrected to "a Google
preview that needs access ONIQ does not have yet", which is true under every
state of the form, and pinned: `capabilityRegistry.test.ts` fails if "asked to
join", "applied" or "requested access" reappears in the gate block, comments
stripped. **The owner's second clause is what caught it**: there is no form in
the app, and the copy implied one had been filled.

MEASURED, free, before any of this was written:

    client code reaching voice-clone    ONLY the admin probe (action "probe").
                                        No screen sends script, create or
                                        speak; no consent screen exists.
    Gemini API discovery, rev 20260904  VoiceConfig carries prebuiltVoiceConfig
                                        ONLY. The one-step replicatedVoiceConfig
                                        is VERTEX-ONLY — service account, not
                                        the API key ONIQ holds.
    cloud.google.com                    proxy 403. The access-form link cannot
                                        be fetched from here; the owner holds
                                        the 2026-09-04d document that has it.

So the consent flow — the script, the two recordings, the word-for-word match —
has never been reachable by anyone: "built and unit-tested is not reachable",
for the third time in this one feature. That is CORRECT while the door is shut
(a control that cannot work is worse than none), and it means that whichever
path is chosen, the user-facing half is unbuilt and stays unbuilt until a path
is measured open.

WHAT IS SETTLED AND WHAT IS NOT:

    settled  the two-step code is built against an allowlisted preview ONIQ
             never applied to; its door is Google's form, an owner action
    settled  the one-step public shape exists only on Vertex, needs the sample
             retained, and has no consent field
    OPEN     whether the one-step path is admitted for oniq-309bd — one
             service-account POST answers it, at the cost of one Lovable message
    OPEN     which path the owner wants, because the second is a policy change:
             a retained voice, and a consent rule ONIQ cannot verify

**PUBLISHED, 2026-09-07, NOT YET VERIFIED ON THE SERVED BUNDLE.** `main` at
`94f3ce1e`; `get_project.latest_commit_sha` read as `94f3ce1e` BEFORE
`deploy_project` — the first read after the push still said `3add29d6`, so the
publish waited ninety seconds rather than rebuilding the previous commit.
Deployment `d5a7eeab`, status `pending`. The served chunk was NOT checked:
`oniqhub.com` answers the proxy's 403 CONNECT from this container, and asking
the Lovable agent to fetch it costs a message under the owner's credit cap.
Verification is one free look: open Create Voice, and the note under the voice
list must read "needs access ONIQ does not have yet", not "has asked to join".

### 2026-09-07 — the errors inbox, read: the chat thread collapses to 20px

The owner opened Moderation inbox -> errors and screenshotted it. Two surfaces,
79 of the 101 rows in fourteen days, and they are different problems:

    chat-viewport   keyboard layout probe   39 rows  7 users  newest 09-07 02:24
    send-push       accepted but sent 0     40 rows  6 users  newest 09-05 16:00

**THE PROBE HAD ALREADY ANSWERED ITS OWN QUESTION, and nobody had read it.**
It was added 2026-08-24 with a comment naming the one number that settles the
layout — `innerH` against `screenH` — and it has been writing that number ever
since. Read at last:

    screenH 832  docH 560  kb 272   832 - 560 = 272 = kb    vvH 288 = 560 - 272
    screenH 851  docH 518  kb 316   851 - 518 = 333 ~ kb    vvH 186 = 518-316-16

**THE KEYBOARD IS IN EVERY ROW TWICE.** The window is already a keyboard
shorter than the screen — it sits above the IME — and the visual viewport then
reports the SAME keyboard occluding what is left. `--vvh` published the
doubly-subtracted number, the chat column took it, and the message list came
out at 20-115px with a keyboard-tall dead band beneath it. Open the keyboard to
type and the conversation is gone.

    scrollerH  20  28  60  115  118  172  ...  and 365 on the one healthy row

That last row is the control and it is what makes this a fix rather than a
fifth guess: same device, ten seconds earlier, `docH 850` on an 851px screen —
the layout viewport had NOT shrunk, the keyboard really was over the window,
and `vvH 548` was correct. **A blanket "prefer docH" would have wrecked it and
put the composer behind the keyboard.**

**`keyboardInset.ts`'s SELF-CORRECTING PROPERTY WAS FALSE, in its own words.**
Its header promised that if a lower layer already shrank the layout viewport
"this difference is ~0. Nothing is subtracted a second time." On these devices
the difference is a full keyboard. The promise was reasoned; the rows are
measured.

FIXED with a discriminator that needs the keyboard-DOWN height, because one
frame cannot carry it: occlusion alone reads identically for "the keyboard is
over the window" and "the window already moved and the keyboard is reported
anyway". `visibleHeight()` is pure and exported; `baseDocH` is the layout
viewport last seen unoccluded, re-read every such frame so rotation and
split-screen replace it for free.

    nativeTook > 100  ->  docH is visible   (the window moved; vv is echoing)
    otherwise         ->  vv.height         (unchanged: today's behaviour)

**`screen.height` LOOKS LIKE THE SAME SIGNAL AND IS NOT.** In split-screen it
exceeds the window by far more than a keyboard with no keyboard present, and
sizing to `docH` there puts the composer behind the IME. The observed baseline
has no such failure — it is this window's own height, whatever the window
manager did to it. Both are asserted.

`src/lib/__tests__/keyboardVisibleHeight.test.ts` runs the REAL ROWS, not
fixtures — this repo has the receipt for what invented fixtures cost, in the
UPI entry four sections up. Mutation-checked both directions, which is the
whole point: reverting to `vv.height` fails the two broken rows, and blanket
`docH` fails the control and the split-screen case. Predicted 20 -> 352 and
115 -> 387.

**AND ONE OLD TEST WENT RED FOR THE RIGHT REASON.** `keyboardInset.test.ts`
required the literal `Math.round(vv.height)` — it pinned one of the two answers
as the implementation. A test that pins an implementation goes red when the
implementation is corrected, which is what happened; it now pins the PROPERTY
(--vvh is always a MEASURED height, never a subtraction composed here) and
leaves WHICH to the row-driven test.

**LIVE, 2026-09-07.** `main` at `a04a37dd`, published, and the two markers
checked in the two chunks that carry them — neither is in the entry:

    entry   assets/index-UxYLFsmV.js
    push chunk  push-BVhfzaNY.js                     5,647 bytes
      push-register = 1        --vvh = 0
    chat chunk  app.chat._conversationId--HTmalfo.js 96,328 bytes
      push-register = 0        --vvh = 1

`push-register` is the decisive one: a string literal that existed in NO earlier
build, so a 1 cannot be left over from a previous deploy. The cross-zeros are
the other half — each marker appears in its own chunk and not the other, so
neither reading is a stray match somewhere else in the bundle.

**STILL UNPROVEN, AND STATED AS UNPROVEN.** Nothing here has been on a handset.
The probe stays, bounded at two per thread, and now reports `vvh` — what the
module DECIDED — so the next row says which branch ran instead of leaving it to
be inferred. **The gate is a thread you can read with the keyboard up, not a
green build.** Every green build in the four previous attempts was green while
this was broken.

#### The other surface: "accepted but sent 0" is not a send bug

Measured before touching anything, and it settles it:

    for every sender in those 40 reports, joined to their conversation partners
    -> the RECIPIENT had ZERO rows in device_tokens, on almost every pair

So nothing failed to send; there was no address to send to. `send-push` has
returned `unaddressed: <count>` since 2026-08-22 and `push.ts` started
RECORDING it at 03:30 today, so the next such report names registration as the
fault by itself. **Both halves are already live — no action needed there, and
checking beat assuming: the field looked missing from the rows only because
every row predates the client that reports it.**

**THE REAL DEFECT IS AT THE OTHER END, and it was silent.** `initPush()` runs on
every authenticated mount, so those accounts had the code run and still ended
up unreachable. `upsertToken` swallowed an RLS conflict into a `console.warn` —
the documented case is a token row still owned by the PREVIOUS account on a
shared device — and a throw went into a bare `catch` under a comment saying
push is best-effort. Neither reaches a phone's console. The outcome is an
account with no push address for the life of the install, recorded nowhere.
Both now report to the same inbox the owner was reading.

**THE TOKEN IS NEVER REPORTED.** It is the address a push is delivered to;
`platform` and the provider's `reason` are what a fix needs.
`pushRegisterVisible.test.ts` pins that, mutation-checked three ways (the
report removed, the throw re-swallowed, the token leaked into the detail).

**AND THAT GUARD MADE THE PROSE MISTAKE TWICE IN ONE FILE**, one level apart,
which is worth more than the guard. First it used `executableText`, which
blanks string CONTENTS as well as comments — so `"push-register"` became `""`
and four assertions failed against correct source; `stripComments` is the right
tool, because the strings ARE the subject here. Then, banning `/token/` across
the whole call matched the MESSAGE, `"device token upsert failed"` — a name for
the problem, not a leak of anyone's address. The window is the third argument
alone. **Strip exactly what you are confusing yourself with, and no more, and
scope a ban to the thing that actually travels.**

### 2026-09-07 — "download option not working", and two verification mistakes on the way

**THE BUG WAS A SILENT NO-OP, and the file that explains it was already in the
repo.** `MediaSaverPlugin.java` records what an `<a download>` does inside a
Capacitor WebView, in its own words: _"no DownloadListener is attached, so the
click is swallowed silently"_. That plugin exists because the behaviour once
destroyed a film — the web layer reported success and told the server to purge
the only copy.

`deliverFile` and `shareFile` in `src/lib/saveFile.ts` kept that dead anchor as
their fallback for everything ELSE. So on Android, whenever the native share
path was unavailable or threw, the Download button on `/app/made/…` ran the
no-op, `webDeliver` returned `"downloaded"`, and `OniqResultActions` showed no
error. A button that does nothing and says nothing, for pictures, songs and
voice clips. **Films were never affected** — `storyJobsClient` streams to disk,
checks the file is non-empty, throws on failure, and hands to `MediaSaver`.

Fixed native-only: share sheet -> the signed URL to the system browser
(`@capacitor/browser`, already a dependency, so no native code and no Play
release) -> a THROW so the existing "Couldn't download that one" toast fires.
The web path is untouched, because there the anchor works.

`saveFileNative.test.ts` reads the source rather than running it, deliberately:
`Capacitor.isNativePlatform()` is false in vitest, so a behavioural test would
exercise the WEB path and pass whatever the native branch did — the same trap
as `phoneLoginVisible` short-circuiting on a flag.

**MISTAKE ONE: PUBLISHED BEFORE THE SYNC, having talked myself out of the
check.** `oniq-ship` says in as many words to read `latest_commit_sha` BEFORE
`deploy_project`. It was skipped to avoid one expensive read, on the reasoning
that the marker check afterwards would catch a stale build anyway. It did —
which is the only reason this is a footnote rather than a false "it's live":

    entry index-DIaw4enL.js   IDENTICAL to the previous publish
    saveFile-DkG8AEgs.js      native-delivery-unavailable = 0

`get_project` then showed `aeeda001` synced, and the republish carried it:

    entry index-DMXXSEBe.js   saveFile-Da2r9IhH.js  3,196 bytes (was 2,591)
      native delivery unavailable = 1

The reasoning was wrong even though the safety net held. Checking the sha costs
one read; a publish that silently rebuilds the previous commit costs a
verification round trip AND the chance of claiming something is live when it is
not. Do the check.

**MISTAKE TWO: A MARKER THAT THE BUNDLER ERASES IS A FALSE NEGATIVE.** The same
check asked for `capacitor/browser` and got 0 on production, which reads exactly
like a missing feature. It is not: the LOCAL build, whose source is known
correct, also returns 0 — Rolldown rewrites `import("@capacitor/browser")` into
a chunk reference and the literal path does not survive minification, while
`Browser` does.

`oniq-ship` already says to learn WHICH CHUNK carries a marker from a local
build first. This adds the other half: **check the marker SURVIVES that build at
all.** A string that exists in source and not in the bundle will read as a
stale deploy forever, and the natural response — republish — never fixes it.
Prefer a plain string literal the code actually emits (an error message, a
`data-testid`) over an import path or an identifier.

# ONIQ provider verification — Google + Runway

Probed 2026-08-23. **No secret was read, printed, logged, committed or placed in
any artifact. No provider call was made. ₹0 spent.**

---

## Result

```
GOOGLE_CONNECTED   = YES (in production)   — NOT reachable from this session
RUNWAY_CONNECTED   = INTEGRATION EXISTS    — NOT reachable from this session
LIVE_TEST_STATUS   = BLOCKED — CREDENTIAL_UNREACHABLE, not budget
```

**The blocker is not money and not authorisation.** It is that no code path from
this container can reach either provider. Stating it as
`LIVE_TEST_BUDGET_REQUIRED` would be wrong — a budget would not help.

## A correction to my own previous report

My last report said **"there is no Runway integration anywhere in the
repository."** **That was wrong.** I searched `supabase/functions/` and the
migration history and did not search `src/lib/`. There **is** a server-side
Runway adapter:

`src/lib/runway.server.ts` — admin-gated, server-only, never imported by the
client, and its header states `RUNWAY_API_KEY` "is read here and only here…
never returned to the browser, never logged, and never embedded in an error
message."

That changes the position materially: Runway is **not** greenfield integration
work. It exists and is one network-policy entry away from being testable.

## What the repository actually wires

### Google

| item               | value                                                  |
| ------------------ | ------------------------------------------------------ |
| secret name        | `GOOGLE_AI_API_KEY` (**name only** — value never read) |
| consumed by        | `supabase/functions/story-clip/index.ts`               |
| endpoint           | `https://generativelanguage.googleapis.com/v1beta`     |
| API surface        | **AI Studio / Gemini API — not Vertex AI**             |
| model wired        | `veo-3.1-fast-generate-preview`                        |
| durations accepted | **4, 6, 8 s** — "no 10 on this API and no extend"      |
| gate               | `STORY_JOB_SECRET`-signed per-job capability token     |
| production switch  | `STORY_MOVIE` env — **unset**, so the stage never runs |

### Runway

| item                 | value                                                         |
| -------------------- | ------------------------------------------------------------- |
| secret name          | `RUNWAY_API_KEY` (**name only**)                              |
| adapter              | `src/lib/runway.server.ts`                                    |
| endpoints            | `api.dev.runwayml.com/v1/image_to_video`, `/v1/tasks`         |
| API version pin      | `2024-11-06`                                                  |
| model allow-list     | **`gen4_turbo`** (only)                                       |
| durations allow-list | **5, 10 s** (only)                                            |
| ratio allow-list     | `720:1280`, `1280:720`, `960:960`, `1104:832`, `832:1104`     |
| **in-repo rate**     | **`CREDITS_PER_SECOND = 5`** for `gen4_turbo`                 |
| gate                 | `requireAdmin` → `is_admin` RPC checked with the service role |

**720p is available in both orientations** — `1280:720` landscape and
`720:1280` vertical. The vertical ratio matches ONIQ's 1080×1920 delivery shape.

## Reachability — measured, and the distinction matters

| endpoint                                          | result                                                                              | interpretation                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generativelanguage.googleapis.com/v1beta/models` | **HTTP 403** with Google's own body: _"Method doesn't allow unregistered callers…"_ | **Host REACHABLE.** This is Google answering, not the proxy. It does **not** appear in the proxy's relay-failure log. Only the credential is missing. |
| `api.dev.runwayml.com/v1/tasks`                   | `000` — `connect_rejected` @ 18:47:27.752Z                                          | **Host BLOCKED by egress policy.**                                                                                                                    |
| `api.runwayml.com/v1/models`                      | `000` — `connect_rejected` @ 18:46:59.069Z                                          | **Host BLOCKED.**                                                                                                                                     |
| `bqwttemnnoexadpwifcj.supabase.co/functions/v1/…` | `000` — `connect_rejected` @ 18:46:59.106Z                                          | **Project BLOCKED** — the deployed functions that _do_ hold the secrets cannot be invoked from here either.                                           |

That last row is the one that closes every route. The credentials live in the
**deployed Supabase edge-function environment**. This container can neither read
them (correctly — they are not exposed to it) nor ask the function that holds
them to act, because the project host is egress-blocked.

## Credential presence in THIS container

| secret                      | status           |
| --------------------------- | ---------------- |
| `GOOGLE_AI_API_KEY`         | `SECRET_MISSING` |
| `RUNWAY_API_KEY`            | `SECRET_MISSING` |
| `LOVABLE_API_KEY`           | `SECRET_MISSING` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SECRET_MISSING` |
| `STORY_JOB_SECRET`          | `SECRET_MISSING` |

`SECRET_MISSING` here means **"not present in this session's environment"**, and
that is the correct and safe design — a dev container should not hold production
provider keys. It does **not** mean the secrets are unconfigured in production.

## Runway pricing — still `PRICING_OPEN`

The repository gives **`CREDITS_PER_SECOND = 5`** for `gen4_turbo`. That is a
credit rate, **not a price**: converting it to rupees needs Runway's current
credit price, and `runwayml.com` is egress-blocked, so it could not be verified.

**No Runway ₹/second is recorded and none is invented.** What _can_ be said:
the cheapest possible Runway connectivity test is **5 s × 5 credits = 25
credits**, because 5 s is the shortest duration the adapter's allow-list permits.

## Google model availability — `OPEN`

Which Veo models the connected account may call **cannot be determined without
calling `models.list` with the credential**. The repo wires
`veo-3.1-fast-generate-preview`; whether Lite is enabled on that account is
**`OPEN`**. Note the repo's Veo path is the **AI Studio** API, while the verified
pricing table came from **Vertex AI** — the two surfaces do not necessarily
expose the same model set, and that discrepancy is itself `OPEN`.

## What would unblock a live test

Any **one** of these, in ascending order of cost to you:

1. **Allow `generativelanguage.googleapis.com` a credential in this session.**
   The host is already reachable — only the key is absent. Cheapest Google test:
   one **4-second** Veo clip (the shortest the API accepts).
2. **Allow the Supabase project host** so the deployed `story-clip` function can
   be invoked with its own secrets — no key ever enters this container. Also
   needs a `STORY_JOB_SECRET`-signed token.
3. **Allow `api.dev.runwayml.com`** plus a credential, for the Runway half.
   Cheapest test: one **5-second** `gen4_turbo` clip = 25 credits.

I am not asking for a key to be pasted, and none should be. Options 1 and 3 are
environment-configuration decisions; option 2 keeps every secret server-side and
is the cleanest of the three.

## Per §28 — the live-test gate

Everything §28 requires **before** spending is now in place: the acceptance gate
is implemented and validated, the in-house baseline is measured, and provider
cost is recorded from Google's authoritative page. The one thing missing is the
ability to reach a provider at all.

**STOPPED before generation. 0 provider calls. ₹0 spent.**

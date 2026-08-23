# Provider connectivity report

Probed **2026-08-23T18:59:01Z**, re-run rather than cited. **No secret read,
printed, logged or committed. 0 provider calls. ₹0 spent.**

## Status

```
GOOGLE = REACHABLE_UNAUTHENTICATED   (host answers; no credential in session)
RUNWAY = NETWORK_BLOCKED
SUPABASE_FUNCTIONS = NETWORK_BLOCKED  (the path that holds the secrets)
```

| endpoint                                          | code    | classification                                                                                                           |
| ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| `generativelanguage.googleapis.com/v1beta/models` | **403** | Google's own body: _"Method doesn't allow unregistered callers."_ **Host reachable** — absent from the proxy denial log. |
| `api.dev.runwayml.com/v1/tasks`                   | `000`   | `connect_rejected` — **egress policy**                                                                                   |
| `bqwttemnnoexadpwifcj.supabase.co/functions/v1/…` | `000`   | `connect_rejected` — **egress policy**                                                                                   |

Credentials in this session, **by name only**: `GOOGLE_AI_API_KEY`,
`GOOGLE_API_KEY`, `GEMINI_API_KEY`, `LOVABLE_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` — all `SECRET_MISSING`. Correct for a dev
container; it says nothing about production configuration.

## Why Phases 3–6 could not run

The desired architecture — session → Supabase function → existing secret →
provider — **is the right design and it is already built**. What blocks it is
that the Supabase project host is egress-blocked, so the deployed functions that
hold the secrets cannot be invoked from here.

**No parallel secret mechanism was created**, per the directive. Creating a
second credential path to work around a network policy would be exactly the
duplication the loop forbids, and it would weaken the server-only boundary.

`GOOGLE_AUTH_STATUS = UNTESTED` · `GOOGLE_MODEL_AVAILABILITY = UNKNOWN` ·
`RUNWAY_STATUS = NETWORK_BLOCKED` · `LIVE_GENERATION = NOT_ATTEMPTED`.

**The single cleanest unblock remains allowing the Supabase project host** —
every secret stays server-side and nothing enters this container.

---

## Attempt 3 — routed through the Lovable sandbox, 2026-08-23T19:47:26Z

**This is the first live provider verification ONIQ has.** It did not come from
this container, which is still blocked exactly as recorded above. It came from
the Lovable agent's sandbox, which already holds the connected secrets and can
reach both Google and the deployed Supabase functions. **No secret was moved,
copied, created or rotated to make this work, and no key entered this session.**

```
GOOGLE_AUTH_STATUS        = AUTHENTICATED          (HTTP 200 on models.list)
GOOGLE_MODEL_AVAILABILITY = ENUMERATED             (50 models)
LIVE_GENERATION           = SUCCEEDED              (one 4s clip, real bytes)
RUNWAY_STATUS             = STILL_UNTESTED         (secret PRESENT, never called)
```

### Secret presence in the DEPLOYED edge-function environment — name only

| secret              | status      |
| ------------------- | ----------- |
| `GOOGLE_AI_API_KEY` | **PRESENT** |
| `RUNWAY_API_KEY`    | **PRESENT** |
| `LOVABLE_API_KEY`   | **PRESENT** |
| `STORY_JOB_SECRET`  | **PRESENT** |

21 secrets are bound to the edge-function environment. **No value was displayed
at any point** — the agent was instructed not to print, echo, mask or log one,
and it did not. This settles the earlier ambiguity: `SECRET_MISSING` in this
container never meant unconfigured in production, and now that is measured
rather than assumed.

### Google — MEASURED, `HTTP 200`

Three Veo models are live on this key:

- `veo-3.1-generate-preview`
- **`veo-3.1-fast-generate-preview`** ← the shipped `CLIP_MODEL`
- **`veo-3.1-lite-generate-preview`** ← the tier the whole pricing model assumed

`gemini-3.6-flash` is live, so the pinned text fallback resolves to a real
model. **`veo-3.0-fast-generate-001` does not appear in the list**, which
confirms the registry tombstone was correct rather than merely suspected.

### The 4-second clip — MEASURED

```
START  HTTP 200   models/veo-3.1-fast-generate-preview/operations/whg5whh164eg
poll 1..3        done:false
poll 4           done:true   mime:video/mp4
video bytes      461532
ffprobe          h264 720x1280 24fps + aac   duration=4.000000
```

One generation, ~30 s wall time, no retry loop. **The end-to-end path works:
signed job token → deployed `story-clip` → Veo → real video bytes back.** Every
`OPEN` item that depended on provider reach is now closed for Google.

**Runway remains untested.** Its secret is present, but nothing called it, so
`RUNWAY_CONNECTED` stays unproven and its ₹ price stays `PRICING_OPEN`.

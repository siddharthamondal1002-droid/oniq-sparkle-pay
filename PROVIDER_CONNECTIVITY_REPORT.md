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

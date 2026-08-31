# Ting "ting choked on that" — diagnosis

## First priority: is it the profiles grant change?

**No.** The Ting path never reads `public.profiles`. The edge function `supabase/functions/ting/index.ts` contains no `profiles` query at all (verified by search); it uses the caller's identity only as a `uid` string for the spend ledger, and all ledger writes go through a service-role RPC, not the caller's JWT. No `select("*")` on profiles anywhere in the Ting client or function. The grant change is ruled out.

## 1. The UI path and the swallowed error

- File: `src/routes/_authenticated/app.ai.tsx`
- Line 242: `toast.error(msg && !/non-2xx/i.test(msg) ? msg : "ting choked on that 😵‍💫 try again")`
- It swallows two things: (a) the `error` object from `supabase.functions.invoke("ting")`, whose message for a non-200 is the generic `Edge Function returned a non-2xx status code` — which the regex deliberately replaces with the toast, and (b) `new Error(d.error)` when the function returns 200 with an `error` field. In this incident it is case (a): the function returned non-2xx, so the real provider error never reaches the device.

## 2. The backend

- Function: `ting` — `supabase/functions/ting/index.ts`
- Runs with the caller's JWT for identity, but all database work (spend ledger admission/settlement) uses `serviceRoleRpc()`.
- Providers: **Anthropic** for both the model and web search (server tool `web_search_20250305`, `max_uses: TING_MAX_SEARCHES`), with a **Google Gemini** (`gemini-3.1-flash-lite`) text-only fallback.
- Secrets: `ANTHROPIC_API_KEY` (primary), `GOOGLE_AI_API_KEY` (fallback), `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (ledger RPC).

## 3. What the logs actually say

Recent `ting` invocations (two, matching the two user attempts) each logged exactly:

```
error  anthropic error 400 {"type":"error","error":{"type":"invalid_request_error",
       "message":"Your credit balance is too low to access the Anthropic API.
       Please go to Plans & Billing to upgrade or purchase credits."}}
warn   Ting: Gemini fallback not admitted (unpriced-model)
```

Boot ~20 ms, immediate shutdown — no timeout, no slow call.

Against your five candidates:
- (a) permission denied from the grant change — **no**
- (b) missing/expired secret — **no**, the key authenticates fine
- (c) upstream billing/quota — **yes, this is it.** Anthropic returns HTTP 400 `invalid_request_error`: the Anthropic account's credit balance is exhausted. Not a 401 and not a 429; it is a billing balance, not a rate limit.
- (d) timeout — **no**
- (e) response-shape change — **no**

Secondary finding, and the reason there is no degraded answer instead of a red toast: the Gemini fallback was refused by the spend ledger with `unpriced-model` — `withSearchSpendGuard` could not compute a worst-case cost for `gemini-3.1-flash-lite` under the fallback's budget, so it declined admission before calling Google. The fallback is therefore currently inert for Ting even when Anthropic is down.

## 4. Did it ever work, and what changed

Yes — Ting with search has been working since the search spend guard went live on 2026-08-24, and the ledger holds successful settled Anthropic searches from that battery. Nothing on this code path changed since; the most recent Ting-adjacent change was the guard wiring itself. The failure is external: the Anthropic account ran out of credit between then and 31 Aug.

## What I propose (nothing applied yet)

Two separate things, both yours to decide because both are business calls:

1. **Anthropic credit** — top up / re-enable billing on the Anthropic account that owns `ANTHROPIC_API_KEY`. This is the actual outage. I cannot do this from here and will not switch Ting onto another paid provider without your say-so.
2. **Fallback + error surfacing** (code, one pass, on your approval):
   - Fix the `unpriced-model` refusal so the Gemini fallback can actually be admitted (add the missing published rate for the failover model to the search budget table, or price the fallback under its token-only rates) — so a provider outage degrades to a Gemini answer instead of a dead toast.
   - Surface the real cause to the user: have `ting` return 200 with a typed `error` (e.g. `provider-unavailable`) instead of a non-2xx, so the UI shows "ting's brain is offline right now" rather than the catch-all, and log the provider status server-side.

No database grant, policy, view or migration is touched by either item. The scroll diagnostic, chat list and call paths are untouched.

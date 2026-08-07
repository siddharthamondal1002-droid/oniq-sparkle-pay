# Runbook — Rotate the Gemini API key (`GOOGLE_AI_API_KEY`)

No source code changes are ever required. The key is read at runtime by
`supabase/functions/_shared/llm.ts` (`Deno.env.get("GOOGLE_AI_API_KEY")`), so
rotation is: mint → store → restart the functions that read it.

## When to run this

- The key was pasted into chat, a log, a screenshot, or a commit.
- Google returns `403 PERMISSION_DENIED` / `API key not valid`.
- Routine rotation (recommend every 90 days).

Note: `429 RESOURCE_EXHAUSTED` ("prepayment credits are depleted") is a
**billing** problem, not a key problem. Rotating will not fix it — top up in
AI Studio instead.

## Step 1 — Mint a new key (user, in Google AI Studio)

1. Open https://aistudio.google.com/apikey
2. **Create API key** → pick the same Google Cloud project as the old key.
3. Copy the new key. Do **not** paste it into chat, a file, or a commit.

## Step 2 — Store it in Lovable (agent)

Ask the agent: *"Update the GOOGLE_AI_API_KEY secret."*

The agent calls `update_secret` with `["GOOGLE_AI_API_KEY"]`, which opens a
secure form. Paste the new key there. The value is encrypted; it is never
visible to the agent or in the repo.

## Step 3 — Restart the functions that read the key (agent)

Supabase edge functions read env vars at boot, so already-warm isolates keep
the old value until they cycle. Force a fresh boot by redeploying — from the
unchanged repo, no code edits:

The 16 functions that import `_shared/llm.ts`:

```
cv-generate            study-chapter-notes    study-paper-mock       study-quiz
hotel-scout            study-chapters         study-paper-resume     study-tutor
ride-genie             study-paper-finish     study-paper-review     ting
smart-scout            study-paper-generate   study-paper-grade      study-paper-save-draft
```

Ask the agent: *"Redeploy the 16 edge functions that import `_shared/llm.ts`
— no code changes."*

## Step 4 — Verify (agent)

1. Boot check — an unauthenticated POST to `ting` must return `401`
   (not `404`, not `500`/BOOT_ERROR).
2. Live check — send one real message to Ting in the app and confirm a reply.
3. Log check — pull `ting` logs and confirm there is **no**
   `callGemini: GOOGLE_AI_API_KEY not set` and no `403` from Google.

Gemini is the *fallback* engine (Claude is primary), so a broken Gemini key can
stay invisible in normal use — always do the log check.

## Step 5 — Revoke the old key (user)

Back in AI Studio, delete the previous key. Do this **after** Step 4 passes, so
there is no gap in service.

## Step 6 — If the key leaked

Also confirm nothing else needs rotating: this key is used only by
`_shared/llm.ts`. Unrelated keys (`ANTHROPIC_API_KEY`, `GOOGLE_MAPS_API_KEY`,
`LOVABLE_API_KEY`) are separate secrets and are not affected.

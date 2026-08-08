---
name: oniq-ship
description: How a change actually reaches ONIQ users — the Lovable publish loop, why pushing is not shipping, and how to prove something is really live. Use this whenever the work involves deploying, publishing, "is it live", "did it land", checking production, editing anything through the Lovable agent, or verifying that a change users can see actually reached them. Also use it before claiming any piece of work is done and live, because the two most expensive mistakes in this repo are both mistakes of verification rather than of code.
---

# Shipping ONIQ, and proving it shipped

ONIQ is a Capacitor thin wrapper around `https://oniqhub.com`. Web changes reach
users through a Lovable publish, not through a git push. Those are separate
events and conflating them has produced a wrong "it's live" claim.

## The publish loop

```
edit + commit + push to main
        ↓  (Lovable syncs the commit — NOT instant)
Lovable's latest_commit_sha catches up
        ↓
deploy_project  →  builds whatever Lovable has synced
        ↓
verify production actually serves the new bundle
```

**Check `latest_commit_sha` from `get_project` BEFORE deploying.** This is the
one that bit. Calling `deploy_project` seconds after `git push` returns
`{"status":"pending"}` and cheerfully rebuilds the PREVIOUS commit, because
Lovable had not synced yet. The deploy succeeds. The page does not change.
`pending` means "a build started", never "your code is in it".

**Edge functions do not deploy with a web publish.** They are a separate deploy
through the Lovable agent. A web publish leaving a function stale is silent.

## Reaching production at all

`oniqhub.com` and `*.lovable.app` are **blocked by this container's network
policy** — `curl` gets a 403 CONNECT from the agent proxy, which looks like a
site error and is not one. Confirm with
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` and read `recentRelayFailures`.

So **the Lovable agent is the only eye on production.** Ask it to run the
checks and paste raw output. Do not ask it whether something looks right; ask
for the command output and read it yourself.

## Working with the Lovable agent

- **`send_message` times out at 60s client-side, but the message is queued and
  will run.** Do not resend — you will double-spend credits and can get two
  agents editing at once. Poll `list_messages` with `limit: 1` and look at
  `status`: `accepted` means queued, `completed` means it answered.
- `list_messages` without a limit returns ~100k characters and blows the tool
  budget. Always pass `limit`.
- Its commits land on `main` as `Changes` or `Work in progress` — you will need
  `git show --stat` to see what actually moved.
- Give it **one narrow job** and say explicitly what not to touch. It respects
  that. Telling it "do not edit lores.ts, I am writing that myself" avoided a
  conflict.
- **Ask it to say when something is wrong rather than fix it.** It reported the
  stale bundle plainly instead of papering over it, which is the only reason
  that was caught.
- It can generate images and TTS; this container cannot. It has a full ffmpeg;
  this container has a cut-down one. Split work along those lines.

## Proving it landed

Three separate things, and none implies the next:

1. **The asset is reachable.** `curl` it, compare byte count to the manifest.
2. **The shipped bundle references it.** Crawl the production JS chunks and
   grep for the new id AND the old one. New present, old absent.
3. **The page renders it.** Resolving the data module locally is a decent
   proxy; the bundle crawl is the real evidence.

An asset returning 200 says nothing about whether any page links to it. That
distinction is exactly what was conflated when Episode 2 was reported live: the
file served perfectly at the right byte count while the page still ran the
previous build and showed the episode as unavailable.

See `references/verifying.md` for the general habits — they generalise well
past deployment.

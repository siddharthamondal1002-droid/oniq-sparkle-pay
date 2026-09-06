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

**Grep the chunk that actually carries your marker — learn which one from a
local build first.** Verifying the Episode 4 wiring produced two false
NEGATIVES in a row: the entry `index-*.js` and the `app.lores-*.js` route
chunk were both greped, both clean, and a healthy deploy got re-published and
nearly re-diagnosed as broken. The data lived in a third file — Vite had
split `lores.ts` into its own `lores-*.js` data chunk. The reliable order is:
`npm run build` in the agent sandbox, `rg -l <marker> dist/client` to learn
the carrying chunk, then fetch THAT file from production. An unchanged entry
bundle hash is not evidence of a stale deploy — the entry chunk only changes
when its own inputs do.

**And a chunk's NAME tells you nothing about what is in it.** Verifying the
2026-09-06 UPI copy change, the entry bundle returned 0 for BOTH the old
phrase and the new one — which reads like "the change did not ship" and is
actually "you are greping the wrong file". A local build found the site card's
copy in `routes-*.js` and the Home tile's hint in **`useIsAdult18-*.js`**:
Vite names a shared chunk after whichever module happened to land in it first,
so a UPI string lives in a chunk named after an age check. No amount of
reasoning gets you that name. Run the build, `rg -l` the marker, then fetch
THAT file.

**Grep for the OLD string as well as the new one**, and require 0 and 1. Two
zeroes means the marker is not in that chunk at all, which is the false
negative above; only old=0 AND new=1 in the same file distinguishes a landed
change from a mislocated grep.

**AND THE ROUTE CHUNK IS NOT IN THE HTML — it is in the dynamic map inside
`index-*.js`.** Measured 2026-09-06 verifying `/app/diag` and `/app/upi`. Both
pages preload the SAME eighteen entry stubs and neither names its own route
chunk; `curl <page> | grep -oE 'assets/app\.diag-[^"]+\.js'` returns nothing at
all. That empty result looks exactly like "the route was not built", and acting
on it would mean re-publishing a healthy deploy — the same false negative as the
Episode 4 case above, arriving by a different door.

The route chunks are in Vite's `mapDeps` array inside the entry bundle, so the
working order is:

    curl -s <origin>/<page> | grep -aoE 'assets/[^"]+\.js'      # entry stubs only
    curl -s <origin>/assets/index-<hash>.js \
      | grep -oE 'assets/[A-Za-z0-9_.-]+\.js' | sort -u          # <- the real list
    curl -s <origin>/assets/app.diag-<hash>.js | grep -c '<marker>'

Two smaller traps in the same run. **The served HTML is one long line, so `grep`
calls it binary and prints nothing but "Binary file matches" — use `grep -a`.**
And a LOCAL build gives the right chunk NAME but the wrong HASH: local
`app.diag-4V3X-YAM.js` vs production `app.diag-qwjf2xwk.js`, same content. The
name prefix is what transfers between builds; never hard-code a local hash into
a production URL.

Verified this way: `app.diag-qwjf2xwk.js` 7,489 bytes carrying `qr decoder` and
`barcode-detector`; `app.upi-CiGEXn38.js` 19,909 bytes carrying `upi-tab-pay`
and `upi-tab-receive`.

## Working with the Lovable agent

- **`send_message` times out at 60s client-side, but the message is queued.**
  Do not resend — you will double-spend credits and can get two agents editing
  at once. Poll `list_messages` with `limit: 1` and look at `status`:
  `accepted` means queued, `completed` means it answered.
- **`accepted` is not a promise that it will ever run.** A queued message can be
  DROPPED. One carrying a 99 MB attachment sat at queue position 1, then
  `get_message` returned **404** for it — an unrelated `Error: aborted /
has_blank_screen` report had arrived and interrupted the turn, and both agent
  turns ended `stopped` rather than `completed`. The work was silently lost.
  So: a queued message is a request, not a delivery. Confirm by the ARTIFACT
  changing, never by the queue accepting. If a turn ends `stopped`, assume
  anything queued behind it may be gone and re-send.
- **A long message is more fragile than a short one.** After the drop, a
  three-step message — verify, upload, reply with the pointer — survived where
  the previous instruction-heavy one had not. Put the ask first and the
  reasoning after, so an interrupted read still contains the job.
- `list_messages` without a limit returns ~100k characters and blows the tool
  budget. Always pass `limit`.
- Its commits land on `main` as `Changes` or `Work in progress` — you will need
  `git show --stat` to see what actually moved.
- **It owns `package.json` and `package-lock.json`, and both break in the same
  two ways.** On 2026-08-09 CI was red on every commit by both agents, and
  neither had touched a dependency:
  - A **caret range drifted into an incompatible release.**
    `@tanstack/router-plugin: "^1.168.18"` picked up a newly published 1.168.28
    needing `react-router ^1.170.24`, while `package.json` pinned react-router
    at exactly 1.170.21 and the lock held 1.170.23. That three-way mismatch made
    `npm ci` abandon the lock, re-resolve, and fail ERESOLVE. Exact pins on both
    fixed it; a `~` range would still have admitted the bad version.
  - The lock's `resolved` URLs point at **Lovable's Artifact Registry mirror**,
    because that is where its sandbox installs from. `check:deps` flags this and
    says not to relax it. Do the hash comparison it asks for —
    `npm view <pkg>@<ver> dist.integrity` against the lockfile integrity — and
    only repoint the URLs if they MATCH. They did here, so the mirror was
    serving identical bytes. If they ever differ, stop: that is the case the
    check exists for. Rewriting the URLs without comparing would look identical
    in CI and silently disable a supply-chain control.

  Both will come back the next time the bot bumps a dependency. Diagnose with
  `npm ci --dry-run`, which reproduces the resolution failure without needing to
  download anything.

- Give it **one narrow job** and say explicitly what not to touch. It respects
  that. Telling it "do not edit lores.ts, I am writing that myself" avoided a
  conflict.
- **Ask it to say when something is wrong rather than fix it.** It reported the
  stale bundle plainly instead of papering over it, which is the only reason
  that was caught.
- It can generate images and TTS; this container cannot. It has a full ffmpeg;
  this container has a cut-down one. Split work along those lines.

## Handing a file over is four steps, not one

When the artifact is produced on one machine and published from another, there
are four states and each was mistaken for the next at least once on the ep3
build:

1. **Uploaded** — the presigned `PUT` returned 200. This proves bytes reached a
   storage bucket and nothing else.
2. **Delivered** — the other agent has actually read the message carrying it.
   `accepted` does not mean this, and see above for how it can never happen.
3. **Published** — the pointer in the repo names the new asset.
4. **Live** — the deployed build serves it.

"The finished episode is now in their hands" was said at state 1. It was at
state 2 and then fell out of the queue entirely. Name the state you are in.

**Match on the byte count, never the filename.** By the end of ep3 there were
three finished files — 102,898,571, 103,903,131 and 104,714,510 — all called
some variant of `ep3.mp4`, all valid, only one correct. The count in the
`.asset.json` is the identity check, and it is the thing to quote when asking
someone else to confirm a publish.

## Three closed doors is not proof the room has no exit

Handing the finished episode over looked impossible: the CDN 403s from the dev
container, GitHub release-asset upload is refused for this session type, and a
100 MB mp4 must not enter git. All three are true. From them came the conclusion
that no route existed, a message to the project owner saying so, and a request
that another agent spend forty minutes re-rendering a file already sitting on
disk.

The route was documented — step 10 of `oniq-video/references/making-an-episode.md`,
in the runbook being followed at the time. `get_file_upload_url` returns a
presigned URL on `storage.googleapis.com`, which the proxy permits.

Before telling anyone something cannot be done, re-read the step you are on.
Enumerating failures feels like diligence and is not the same as searching.

## A green workflow is not a correct artifact

CI going green says the steps exited zero. It says nothing about whether what
they produced is right.

The ep3 clip transfer succeeded in 23 minutes and looked finished. What actually
confirmed it was downloading the published bundle, rejoining the parts,
verifying 60 of 60 checksums, and probing every clip against the CURRENT shot
plan — 0 mismatches, with the one clip that had exposed the earlier staleness
now at its correct frame count. The run before it was ALSO a valid workflow; it
failed because the artifact was wrong, which is the whole point.

So when a job publishes something, verify the something. Download it, open it,
and check it against the source of truth it is supposed to match. Three checks
were worth the two minutes here: the bundle rejoins, the checksums hold, and the
contents agree with the repo at HEAD.

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

# ONIQ MASTER SUPERLOOP — PASS 01: DISCOVERY

Read-only pass. No code edited, no migration run, no function deployed, no production data written.

## What the app actually is

ONIQ ships as a Capacitor WebView pointed at `https://oniqhub.com`. The Android
app and the website are the same deployment: a web publish changes the app for
every installed user without a Play release — and does **not** carry edge
functions. Play shows 1.8.3 / 18 Aug 2026, and `android/app/build.gradle` agrees
(versionCode 19, versionName 1.8.3). 111 public tables, 53 edge functions,
4 active cron jobs, 78 route files, 1825 passing tests across 121 files.

## The three-way reconciliation

Full matrix in `product_truth_map.json`. The headline: the Play listing, the
website and the code each describe a different product.

**Play advertises things that are not there.** "Crypto and investing launchers"
has no counterpart anywhere in the source — the mini-app registry has twelve
categories and neither of those is one of them. "Live weather" exists as a
route and a server function but nothing in the entire UI links to `/app/weather`.
"Compares ride options across nine providers" describes a static rate card; the
website's own wording ("fare estimates") is the honest one.

**The website undersells and mislabels.** Jobs is tagged "Coming soon" while 25
CVs have already been generated in production. ONIQ Learn is advertised with an
empty course catalogue (0 courses, 0 lessons, 0 questions).

**The code carries things nobody has announced.** Study is the single most-used
feature in the database — 1,164 chapters, 154 tutor messages, 87 exam papers, 67
quiz attempts — and appears nowhere in the Play listing. The paid Story/Originals
pipeline (46 jobs, 8 price tiers, two crons) is likewise undisclosed. So is a
public MCP tool surface.

**One world is dead in both directions.** Food ordering has no inbound link
anywhere in the UI *and* zero restaurants, zero menu items, zero orders — while
still carrying a money-path RPC.

## What is genuinely working

Chat (833 messages, 57 conversations), Calls (325 call logs, TURN configured),
Moments, Updates, Mast, Study, Blessed, Pulse, Official, Plug (149 visible
mini-apps, matching the site's number exactly), Jobs, Vitals, and the DSR
export/delete machinery with both purge crons running every 15 minutes. RLS is
enabled on all 111 tables — the listing's security claim holds.

## Credentials are a bigger gap than code

Nine secrets are referenced by deployed code and are not configured. The ones
that matter: `MAPPLS_CLIENT_ID/SECRET` (India geocoding for Rides and Scout),
`RAZORPAYX_ACCOUNT_NUMBER` (creator payouts cannot be initiated at all), and
`AMADEUS_*` (flight search cannot succeed). On the good side, the client-side
exposure check is clean — only the publishable Supabase values reach the browser.

## Nothing is marked PRODUCTION_READY

Every candidate feature fails the last clause of your own definition: runtime
proof on a real device. Calls, push delivery, camera QR scanning, offline
behaviour and chat scroll performance are all marked `[HW]` in the gap ledger.
Green tests are source assertions, not evidence that a handset rings.

## Ranked gaps

Seventeen entries in `gap_ledger.json`, ranked by user harm then store exposure.
The top three are the Play crypto/investing claim (a financial-services claim
with no implementation — Play treats these strictly), the nine-provider ride
pricing claim, and the advertised-but-unreachable weather screen. Four items are
marked `owner_decision_needed` because they are business calls, not engineering
ones: whether to build crypto tiles or drop the claim, whether to buy live ride
pricing, whether to retire or seed Food, and whether to fund the payout account.

## Artifacts

`oniq_master_audit/` — `build_identity.json`, `product_truth_map.json`,
`backend_registry.json`, `route_map.json`, `gap_ledger.json`, this report.

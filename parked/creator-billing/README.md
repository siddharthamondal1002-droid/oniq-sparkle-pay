# Parked: creator-subscription billing surface (19 Aug 2026)

The Track B billing surface is NOT launched (`payouts_enabled` is false and no
user can reach it), but shipping it put the app binary out of step with the
Google Play Data safety declaration, which states that no financial info is
collected and lists a fixed set of third-party hosts.

Parked here, out of `src/`, so nothing reaches the client bundle or the
deployed server until the feature launches WITH a matching declaration:

- `purchase.ts` — RevenueCat / Play Billing client wrapper (client bundle).
- `play-rtdn.ts` — Play RTDN worker; calls oauth2.googleapis.com and
  androidpublisher.googleapis.com (server-only, but part of the same
  unlaunched payment surface).

The database work stays live: `creator_ledger`, `creator_accounts`,
`creator_subscriptions`, `creator_sub_skus`, `record_creator_charge`, hold and
clawback logic, and `src/lib/creator/economics.ts`.

To relaunch: move both files back, re-add `@revenuecat/purchases-capacitor` to
dependencies, and update `DATA_COLLECTED` / `THIRD_PARTY_REQUESTS` in
`src/config/playCompliance.ts` plus the Play Console Data safety form in the
same change.

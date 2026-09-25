# Fix the three remaining confirmed findings

All three are confirmed on the current code and database. Each one changes payments, spend or storage, so none is a one-line edit.

## 1. Payment webhook can't confirm orders (high)
Confirmed: the live database has none of the `payment_inbox_*` functions, so every signed Razorpay event gets a 503. Nothing runs the recovery worker on a schedule yet.
- Short-term: restore the old direct grant path in the webhook (resolve binding, confirm, grant). Keep writing to the inbox only if the inbox function exists.
- Later, once the reviewed recovery SQL is applied and the authenticated probe passes: go back to inbox-only and turn on the scheduled worker.

## 2. Retrying an in-house frame is refused as a duplicate (high)
Confirmed: the spend request id is `still:${stillId}` and never changes, and the ledger refuses any request id it has already seen.
- On `start`, give each attempt its own request id (`still:${stillId}:${attemptId}`) and send it back to the worker.
- Poll and settle use the id the worker sends back, falling back to the old id so jobs already in progress still work.
- The per-job attempt ceiling still limits how many retries can spend money.
- Add a test: a second start for the same shot is admitted, and a repeated poll does not settle twice.

## 3. Characters with JPG artwork can't get a locked reference (medium)
Confirmed: publishing only accepts PNG, but 28 eligible characters have JPG art.
- Accept both PNG and JPEG. Store the file under the matching extension, and record the extension in `characterRef` so `story-still` and the worker look up the right key.
- Keep the existing PNG keys working.

## Technical notes
- Files: `supabase/functions/razorpay-webhook/index.ts`, `supabase/functions/story-still/index.ts`, `_shared/inHouseMotion.ts`, `story-reference-publish/index.ts`, `_shared/characterRef.ts`, and the worker's reference lookup.
- Needs one edge-function deploy afterwards. No database migration.

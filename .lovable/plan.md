## Plan — Linked Bank Accounts

Verbatim apply from `oniq-banks-pack.zip`, then run acceptance test.

### 1. Migration
Run `supabase/migrations/20260706000000_bank_accounts.sql`:
- Creates `public.bank_accounts` (holder_name, bank_name, ifsc, `account_last4` only — full number never stored) with `is_primary` flag, RLS on, `SELECT`/`DELETE` grants scoped to `auth.uid()`.
- RPCs (all `SECURITY DEFINER`, granted to `authenticated`):
  - `add_bank_account(holder, bank, ifsc, account_number, nickname?)` — validates IFSC regex, 9–18 digits, max 5, dedupes on (ifsc, last4), stores only `right(acct,4)`, auto-sets primary if first.
  - `set_primary_bank(bank_id)`
  - `withdraw_to_bank(bank_id, amount)` — locks wallet, deducts, inserts `withdrawal` transaction with note `Withdrawal to <bank> ••<last4>`.

### 2. New file
`src/routes/_authenticated/app.banks.tsx` — Linked Banks screen (list, add form, set primary, delete, withdraw sheet).

### 3. Full-file replace
`src/routes/_authenticated/app.pay.tsx` — updated to expose the "Linked banks" entry to `/app/banks`.

### 4. Verify
- `tsgo --noEmit` compile.
- Playwright acceptance: sign in → Pay → Linked banks → add HDFC/Test User/HDFC0001234/123456789012 → card shows `••9012` + Primary → Withdraw $50 → wallet decreases → withdrawal appears in Recent activity.
- DB assertion: `SELECT * FROM bank_accounts` shows only `account_last4='9012'`, no column contains the full number.

### On failure
Stop, report console/network/DB evidence per your Step 4 protocol, no code changes without go-ahead.

### On pass
Report ✅ checklist with balance-before/after and the masked row.

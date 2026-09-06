# ONIQ privacy model

Audited 2026-07-29 against production (read-only queries via the project's
database tooling). Scope: every public table, storage bucket, edge function,
and admin surface.

## Principles

1. Deny-by-default RLS on every table; access scoped to `auth.uid()`.
2. No admin read path to user content (messages, media, contacts, health,
   faith activity, call history). Admin tooling sees aggregates, the report
   queue (user-reported items only), and partner-KYC documents that the
   applicant explicitly submitted for review.
3. All user media buckets are private; access via signed URLs; object paths
   are `<uid>/<uuid>.<ext>` (unguessable).
4. Logs carry no user identifiers, phone numbers, emails, message bodies, or
   media URLs.

## Audit results (2026-07-29)

`scripts/privacy-audit.sql` output:

| Check | Result |
|---|---|
| Tables in `public` without RLS | **0 rows** ✅ |
| Permissive `USING (true)` write policies, or reads on user-content tables | **1 row** — `profiles.profiles_select_all` (SELECT) |
| Public storage buckets | **0 rows** ✅ |

**The one hit, assessed:** `profiles_select_all USING (true)` is row-permissive
but column-restricted. Verified via `information_schema.column_privileges`:
`authenticated` can SELECT only `id, username, display_name, avatar_url, bio,
country_code, language, oniq_pay_enabled, created_at, updated_at`. Sensitive
columns (`date_of_birth`, `is_minor`, parent contacts, `upi_vpa`, `is_admin`,
`last_policy_notice_at`) have **no** SELECT grant and are reachable only via
`get_my_profile_private()` (SECURITY DEFINER, `WHERE id = auth.uid()`).
A social app requires a public member directory of exactly these fields —
**accepted with mitigation**, not a violation.

## Who can read what

| Surface | Data | Reader |
|---|---|---|
| `messages`, `conversations` | bodies, membership | conversation members only (RLS) |
| `moments_posts` / comments / likes | posts | owner, public, or moots via `friendships` check in policy |
| `clips` | videos/thumbs | authenticated (feed filters visibility server-side; private = owner page only) |
| `vitals` / health, `learner_profiles`, `study_papers` | health & study | owner only; `study_papers` is default-deny (edge functions enforce ownership in code because rows hold answer keys) |
| `partner_applications` + `verification-docs` bucket | KYC | applicant + admin **for review the applicant requested** (`is_admin()` guard, signed URLs) |
| `reports` queue | reported item refs | admin (moderation exception: user-reported items only) |
| storage: `clips`, `chat-media`, `moments`, `verification-docs` | media | private buckets; owner-folder writes; signed-URL reads |

## Edge functions

Service-role usage reviewed function-by-function: each verifies the caller's
JWT and acts only on the caller's rows (`study-paper-*`, `delete-account`) or
serves non-user content (news/TV/radio/AI proxies). None accepts an arbitrary
`user_id` and returns that user's content.

`firebase-phone-session` is the one that acts for a caller who has no session
yet, so it cannot check a JWT and does not pretend to. Its credential is the
Firebase ID token's SIGNATURE, verified against Google's published keys for
project `oniq-309bd` before any claim is read; it then mints a Supabase
session for the phone number in that verified token and nothing else. The
MSG91 functions that used to sit here — `send-otp`, `verify-otp`,
`msg91-verify-session` and `check-user-exists` — were deleted on 2026-09-06.
`check-user-exists` is the one worth naming: it answered whether an ONIQ
account exists for a phone number or email, behind a static URL key, for a
widget that no longer exists.

## Deletion

`delete-account` now purges: the user's folders in all four media buckets
(including reel thumbnails), the profile row, and the auth user — 64
`ON DELETE CASCADE` foreign keys remove every dependent row. Retained per
IT Rules 2021: grievance/safety-report correspondence (≤90 days).

## Logging

Client and edge logs reviewed: they carry error messages, queue/message IDs,
and timestamps — no emails, phone numbers, message bodies, or media URLs.
The MSG91 hardcoded widget fallback was removed in the 2026-07-29 security
pass. **Known item:** the protected call stack (`CallOverlay`) logs internal
peer UUIDs for mesh debugging; that file is read-only this sprint — flagged
for the next call-stack change window.

## Deferred (tracked)

- Immutable moderation audit-log (who/what/when/why per admin access) and
  time-boxed report windows — needs schema + admin UI.
- Signed-URL TTL reduction from ~100 years to ≤60 min — requires storing
  storage *paths* instead of signed URLs across chat/moments/clips and a
  resolver hook; top follow-up, touches every media render.

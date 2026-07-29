# ONIQ incident response — breach pipeline & safe automation

> Engineering guidance, **not legal advice**. DPDP Act 2023 / DPDP Rules 2025 /
> IT Rules 2026 / CERT-In obligations must be reviewed by qualified Indian counsel.

## One awareness timestamp, three clocks

Insert a row into `public.security_incidents` the moment a breach is noticed.
`aware_at` drives generated deadline columns:

| Recipient | Deadline | Channel |
|---|---|---|
| CERT-In | **6 hours** from awareness | `incident@cert-in.org.in` (Directions 28 Apr 2022) |
| Affected users | **without delay** | in-app + registered email/SMS |
| Data Protection Board | intimation **without delay**; **detailed report ≤72h** (Rule 7) | Board portal |

Clock discipline: sync server clocks to NTP (`time.nplindia.org` / `samay.nic.in`).
Log retention targets: **security/ICT logs 180 days (in India)**, **access logs ≥1 year**
— configured at the platform level (Supabase log drains); tracked as an
infrastructure follow-up, not app code.

## Templates

**User (plain language, no links, no credential requests — Apple pattern):**
> ONIQ detected a security incident that may have affected your account data
> (what: …; when: …). What this means for you: …. What we've done: ….
> What you can do: change your password from inside the ONIQ app (Profile →
> Security). We will never ask for your password or OTP by email, SMS, or phone.
> Contact: grievance@oniqhub.com.

**CERT-In (≤6h):** incident category, date/time noticed (IST), affected systems,
symptoms, brief impact. No user PII.

**DPBI (≤72h):** facts & causes, mitigation taken, findings on responsible
parties, remediation to prevent recurrence, summary of user notifications issued.

## PII rule for incident rows and logs

`security_incidents.summary/notes` carry **ids, counts, rule names, error
classes only** — never message bodies, media URLs, emails, phone numbers,
tokens, or precise location.

## Detection (server-side, heuristics first)

Run against Supabase auth logs / Postgres (examples, admin-only):
- Credential stuffing: auth failures per IP/identifier over 15-min windows.
- New-device / impossible-travel sign-ins: `auth.sessions` deltas per user.
- Scrape patterns: per-user row-read spikes on feed RPCs.
- RLS-denial spikes and edge-function 4xx bursts.
Emit findings as `security_incidents` rows (severity-tiered).

## Safe automated containment (reversible only)

Allowed without human approval: revoke refresh tokens (global sign-out),
force re-auth, temporary `banned_until` on a single account, rate-limit
tightening, feature-flag degradation. All actions logged.
**Destructive/irreversible actions require founder approval.**
Access-token caveat: JWTs stay valid until expiry — keep expiry short.

## The forbidden version (explicitly absent)

ONIQ contains **no** code path that: lets an AI mutate production, auto-merges
or auto-deploys generated code, holds production write credentials for any
automation, sends user content to an external AI service, or performs any
offensive/retaliatory ("hack-back") action — the latter is illegal under IT Act
ss. 43/66 (and 66F for protected systems). Per NIST SP 800-61r3 and OWASP
LLM Top-10 2025 (LLM01 prompt injection, LLM05 output handling, LLM06 excessive
agency): all model input is untrusted, model output is never executed, and any
AI involvement is limited to **drafting** human-reviewed pull requests and
plain-language triage summaries built from **minimised, content-free features**.

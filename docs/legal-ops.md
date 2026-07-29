# ONIQ — Legal Operations Runbooks (L1–L6)

> **NOT LEGAL ADVICE.** These runbooks were drafted by an AI engineering
> assistant to give ONIQ operational scaffolding. Every procedure, statutory
> reading, and deadline here MUST be reviewed and signed off by qualified
> Indian counsel before it is relied on. Where this document and counsel
> disagree, counsel wins.

Contacts (single-founder configuration, to be updated as the team grows):

- **Grievance Officer:** founder — grievance@oniqhub.com
- **LEA / lawful-request contact:** founder — grievance@oniqhub.com (dedicated
  legal@ alias recommended). Note: ONIQ is far below the 50-lakh registered
  user threshold for a "significant social media intermediary" under the IT
  Rules, so the SSMI-only obligations (nodal contact person, monthly
  compliance reports, Chief Compliance Officer) do not yet attach — but a
  designated LEA contact is good practice and is designated here anyway.

---

## L1 — Lawful request intake (BNSS s.94 / court / government orders)

Storage: `public.legal_requests` (admin-only RLS, dual-control state machine
enforced by `legal_request_guard` trigger).

Intake checklist — record for EVERY request before touching any data:

1. **Issuer**: court, police station officer (BNSS s.94 allows an officer in
   charge of a police station or a court to summon documents), or government
   department. Capture name, designation, and station/court.
2. **Written order**: demand the order in writing (email PDF acceptable);
   record `order_ref`. Verbal/WhatsApp demands → ask for the written order;
   do not act without it.
3. **Scope**: exact `target_identifier` (user id / phone / handle), exact
   `records_sought`, and a bounded time `window_start..window_end`.
4. **Overbroad flags** — set status `flagged_overbroad` + `flag_reason` and
   route to counsel if ANY of:
   - no named individual or account (bulk / "all users who…");
   - no time window, or window > 12 months without justification;
   - content of communications requested under a mere s.94 summons
     (message *content* generally needs a stronger basis than metadata —
     counsel to assess per request);
   - requests for real-time interception (that is a s.69 IT Act / Telegraph
     Act process with its own competent authority — NOT servable as a s.94
     summons; refuse and escalate to counsel);
   - anything targeting journalists, rivals, or with signs of personal
     motive.
5. **Dual control**: two distinct admins must record approval
   (`approver_1`, `approver_2`) before status can reach `approved`. The DB
   trigger enforces this; do not bypass it with service-role SQL.
6. **Fulfilment**: only via `scripts/evidence-export.ts` (see L3). Minimum
   necessary records only. Never grant standing/portal access.
7. **User notification**: conservative rule — do NOT notify the target user
   while a written order is pending or where notification could amount to
   tipping off in an active investigation; ask counsel per case. Log the
   notify/don't-notify decision in `notes`.

## L2 — Legal holds (preservation)

Storage: `public.legal_holds`. A hold **suspends erasure only** — it grants
zero read access to anyone (retention layer, not an access layer).

- Create with `subject_user_id`, `scope` (default `account`), a mandatory
  `override_reason`, and an `expires_at` (holds must expire; renew
  deliberately rather than holding forever).
- Effect: the `delete-account` edge function returns **409** while
  `has_active_legal_hold(uid)` is true, telling the user deletion is
  temporarily unavailable for a legal preservation reason and pointing to
  grievance@oniqhub.com. DPDP s.17 exempts processing necessary for legal
  obligations from erasure; record WHICH obligation in `override_reason`.
- Release: set `released_at` + `active=false` the moment the underlying
  matter closes. Sweep expired holds monthly.

## L3 — Evidence export (BSA s.63)

Tool: `scripts/evidence-export.ts <legal_request_id>` — run manually, with
counsel, only for an `approved` request (the script re-verifies status AND
two distinct approvers; the DB trigger enforces the same server-side).

Output per request (`docs/evidence-exports/<id>/`, then move OFF-repo to
sealed storage — never commit): `records.json` (scope-limited; empty scaffold
by default — the operator populates exactly the records sought, no fishing),
`hash-report.txt` (SHA-256, a BSA-Schedule-named algorithm),
`certificate-63.md` (s.63(4) certificate; Part A populated for ONIQ as
producer, Part B is a scaffold for the expert signatory — per the Supreme
Court's 2026 clarification in the Pune Bar Association matter, counsel must
confirm who signs as expert), `custody-note.md` (append a line on every
transfer, re-verify the hash each time).

## L4 — Self-harm signals (care-first, never punitive)

Implementation: `src/lib/selfHarm.ts` (on-device regex, en/hi/bn) +
`CrisisSupportSheet`. Triggered AFTER a post publishes normally — the post is
never blocked, flagged, or queued for moderation by this path, and no signal
is written to any server table. The sheet offers Tele-MANAS
(14416 / 1-800-891-4416) and KIRAN (1800-599-0019) with tap-to-call, and an
"I'm okay" dismiss. Rationale: a false positive must cost the user nothing.

## L5 — NCII / voyeurism SLAs

Report categories now include NCII ("intimate image shared without
consent"), voyeurism/hidden camera, and impersonation.

SLA configuration (IT Rules 3(2)(b) baseline):

| Trigger | Clock | Target |
| --- | --- | --- |
| Valid NCII/voyeurism complaint from the individual or their agent | from complaint | **remove/disable within 24 h** |
| Takedown order, source `ncii_csam` (in `takedown_orders`) | from `received_at` | **2 h** (self-imposed, stricter than rule) |
| Other lawful takedown orders | from `received_at` | **3 h** (self-imposed) |
| Grievance acknowledgement | from receipt | 24 h ack, 15 days resolution (36 h for serious classes as stated in-app) |

Operational steps for an NCII report: (1) view IDs only, never re-share the
media; (2) `admin_takedown_content` to soft-delete; (3) hash the media (
`media_provenance` sha256 if present) so re-uploads can be matched manually;
(4) preserve the record under an L2 hold if the victim signals police
involvement; (5) offer the reporter the cybercrime portal
(https://cybercrime.gov.in) — voyeurism/NCII are offences under BNS s.77 and
IT Act ss.66E/67/67A.

## L6 — CSAM (child sexual abuse material)

**Reporting is mandatory, not optional.** POCSO ss.19–20 oblige ANY person
(and specifically providers of media/material) who knows of an offence or
material to report it; failure is itself punishable (s.21). The Supreme
Court in *Just Rights for Children Alliance v. S. Harish* (2024 INSC 716)
confirmed even storage/viewing of CSAM is punishable and reporting duties
are strict.

On ANY credible CSAM report or discovery:

1. **Do not view beyond the minimum** needed to classify; never download,
   copy, or re-share. Two-person rule for classification if possible.
2. **Remove immediately** (`admin_takedown_content`) — the 2h `ncii_csam`
   SLA is a ceiling, not a target; act in minutes.
3. **Preserve, do not delete, the underlying evidence**: place an L2 hold on
   the uploader account; keep the storage object quarantined (do NOT purge
   it as part of takedown) so police can seize it properly.
4. **Report the same day** to: the local police / SJPU (Special Juvenile
   Police Unit), AND the National Cyber Crime Reporting Portal
   (https://cybercrime.gov.in — "Report CSAM/CSEM" flow, can be anonymous
   but ONIQ reports as itself). Record portal acknowledgement number in
   `legal_requests.notes` or the takedown row.
5. **No user notification** to the uploader beyond the generic removal
   notice; never tip off.
6. Log every step in `audit.moderation_log` (ids and reasons only).

---

*Review cadence: counsel review before production launch, then quarterly.*

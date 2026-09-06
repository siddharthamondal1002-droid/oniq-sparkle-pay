// Audio/video calls, on Metered.ca managed TURN. The original blocker — the
// decommissioned openrelay project hanging every call on "Connecting…" — is
// gone: `get-turn-credentials` fetches managed credentials server-side and the
// client REFUSES to start a call unless the response says source:"metered"
// with real turn:/turns: URLs (IceUnavailableError → clear toast, never a
// hang). So the failure mode this flag guarded against no longer exists; if
// the METERED_* secrets ever lapse, calls degrade to an honest error, not to
// silence.
export const CALLS_ENABLED = true;

// Master kill-switch for phone/OTP login. When true, the phone tab still only
// appears if Firebase's web config is present in the bundle, so users never
// see a dead-end path.
//
// OWNER DIRECTIVE, 2026-09-06 — ON. The owner was shown the full measured
// evidence below, was told plainly which two things remain unproven and that
// turning this on ships them to all 125 users, was offered a canary that would
// have proven delivery on one handset first, and chose to turn it on. Recorded
// as given; the risk is stated, not hidden.
//
// It was off before this for the same reason it was off under MSG91: no code
// had ever been observed to arrive. The MSG91 path was removed the same day
// ("that path was never proven successful") and the send now runs on Firebase
// Phone Auth, which the console work of 2026-09-05 measured all the way to
// MISSING_CLIENT_IDENTIFIER — Google asking for the browser attestation a
// server cannot mint, i.e. every check before it passed.
//
// WHAT IS ACTUALLY PROVEN, so the next reader does not have to take it on
// trust. Measured 2026-09-06 with a Firebase test phone number, which
// runs the entire real flow with a fixed code and sends no SMS, so it cost
// nothing (`npx tsx scripts/prove-firebase-phone.ts` re-runs the free half):
//
//   sendVerificationCode                200  sessionInfo
//   signInWithPhoneNumber               200  a real Google-signed ID token
//   verifyFirebaseIdToken vs live JWKS  ACCEPTED   (RS256, iss/aud oniq-309bd,
//                                       sign_in_provider phone)
//     controls on the SAME token        wrong project -> bad iss
//                                       tampered      -> bad signature
//                                       clock +2h     -> expired
//   POST firebase-phone-session         200  {"verified":true,
//                                             "email":"phone_…@oniq.phone"}
//   GET  /auth/v1/verify?type=magiclink 303  access_token returned
//   GET  /auth/v1/user with it          200  phone_9000000001@oniq.phone
//                                            {auth_via:"firebase_phone",
//                                             phone_verified:true}
//
// The last two lines are the ones worth having asked for. The function issuing
// a token_hash is not the same fact as that hash minting a SESSION, and it is
// the session that is the sign-in. Both throwaway records were deleted and the
// test number removed in the same run.
//
// STILL UNPROVEN AT THE MOMENT THIS WENT ON, and neither can be proven from a
// server: the reCAPTCHA a real number requires in a real browser on
// oniqhub.com, and whether an SMS actually ARRIVES. Test numbers skip the
// attestation step — that is what makes them free, and it is exactly the step
// production depends on.
//
// SO THE FIRST REAL SIGN-IN IS THE TEST. If a code does not arrive, or
// reCAPTCHA refuses on oniqhub.com, set this back to false — that is a
// one-word rollback needing no other change, and `phoneLoginVisible` below
// then puts it straight back into canary mode so the fix can be proven on one
// handset. Symptoms to expect: "couldn't send the code" on every attempt means
// reCAPTCHA (check that oniqhub.com is still an authorized domain and that the
// page is not being served from www.oniqhub.com, which is NOT one); the code
// box appearing but no SMS ever landing means delivery, which is Google's
// side and shows up on the Blaze bill.
export const OTP_LOGIN_ENABLED = true;

/**
 * Should the phone tab render?
 *
 * REDUNDANT WHILE THE FLAG IS ON, AND KEPT ON PURPOSE. It exists to break a
 * deadlock: the last two unproven things need a real handset on the live site,
 * and while the flag is off the tab never renders, so there is nothing to
 * reach. The owner chose to turn the flag on instead of proving it through
 * here first — which means this is now the ROLLBACK path, not the rollout one.
 * Set `OTP_LOGIN_ENABLED` back to false and `/auth?phone=1` immediately opts
 * one browser in again, so whatever failed can be fixed and re-proven on a
 * single handset without the tab being live for everyone. That is why it stays
 * rather than being deleted as dead code.
 *
 * IT IS NOT A SECURITY BOUNDARY AND MUST NOT BECOME ONE. Anyone who reads this
 * file can type the parameter. What actually guards the send is Firebase's
 * reCAPTCHA and its own abuse controls — the same things that will guard it
 * when the flag is on. This only decides who SEES the tab, so the worst a
 * stranger gets is the flow the owner is about to ship anyway.
 *
 * Pure, and takes the query string rather than reading `location`, so it is
 * testable and so the caller decides what "the current URL" means.
 *
 * THE PARSING IS A SEPARATE EXPORT FOR A REASON. `phoneLoginVisible` short-
 * circuits on the flag, so while the flag is ON it returns true for every
 * input — which means tests written against IT stop exercising the parameter
 * entirely the moment the flag flips, without failing. They just quietly assert
 * nothing. `phoneOptInParam` is what the parameter tests target, so the
 * rollback path stays covered whichever way the flag is set.
 */
export function phoneOptInParam(search: string | undefined): boolean {
  if (!search) return false;
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("phone") === "1";
}

export function phoneLoginVisible(search: string | undefined): boolean {
  return OTP_LOGIN_ENABLED || phoneOptInParam(search);
}

// Attachment-sheet feature flags: a tile with a flag stays hidden everywhere
// until its feature ships — flip here, it appears on every surface at once.
export const ATTACH_FLAGS: Record<string, boolean> = {
  aiImages: false, // no image-generation backend yet
  polls: false, // no poll schema yet
  events: false, // no event schema yet
  reelTools: false, // audio-track/duration editors not built
  textOverlay: false, // overlay editor not built
  contactShare: false, // needs native contact picker UI
};

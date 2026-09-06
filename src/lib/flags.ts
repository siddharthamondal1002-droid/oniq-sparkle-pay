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
// STILL OFF, AND FOR THE SAME REASON IT WAS OFF UNDER MSG91: no code has ever
// been observed to arrive. That path was removed on 2026-09-06 ("that path was
// never proven successful") and the send now runs on Firebase Phone Auth,
// which the console work of 2026-09-05 measured all the way to
// MISSING_CLIENT_IDENTIFIER — Google asking for the browser attestation a
// server cannot mint, i.e. every check before it passed.
//
// WHAT FLIPS THIS IS A DELIVERED SMS, NOT A GREEN BUILD — and as of 2026-09-06
// that is the ONLY thing left. Measured with a Firebase test phone number, which
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
// STILL UNPROVEN, and neither can be proven from a server: the reCAPTCHA a real
// number requires in a real browser on oniqhub.com, and whether an SMS actually
// ARRIVES. Test numbers skip the attestation step — that is what makes them
// free, and it is exactly the step production depends on.
export const OTP_LOGIN_ENABLED = false;

/**
 * Should the phone tab render?
 *
 * THIS EXISTS TO BREAK A DEADLOCK, not to add a feature. The last two unproven
 * things need a real handset on the live site — and while the flag is off the
 * tab never renders, so there is no way to reach the flow to prove it. Flipping
 * the flag to find out would ship an unproven, SMS-spending path to all 125
 * users, which is precisely how the MSG91 path came to sit dead for weeks.
 *
 * So `/auth?phone=1` opts one browser in. Nobody discovers it by using the app;
 * the owner proves delivery on their own handset for the price of one SMS, and
 * only then does `OTP_LOGIN_ENABLED` flip and the parameter become redundant.
 *
 * IT IS NOT A SECURITY BOUNDARY AND MUST NOT BECOME ONE. Anyone who reads this
 * file can type the parameter. What actually guards the send is Firebase's
 * reCAPTCHA and its own abuse controls — the same things that will guard it
 * when the flag is on. This only decides who SEES the tab, so the worst a
 * stranger gets is the flow the owner is about to ship anyway.
 *
 * Pure, and takes the query string rather than reading `location`, so it is
 * testable and so the caller decides what "the current URL" means.
 */
export function phoneLoginVisible(search: string | undefined): boolean {
  if (OTP_LOGIN_ENABLED) return true;
  if (!search) return false;
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("phone") === "1";
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

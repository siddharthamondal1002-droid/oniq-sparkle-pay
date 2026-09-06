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
// ON — and the round trip through `false` was MY ERROR, kept here because the
// mistake is the useful part.
//
// The owner turned this on as a deliberate decision, having been shown the
// evidence and told which two things were unproven. It then failed on a real
// handset in the Android app with:
//
//     Firebase: Error (auth/internal-error).
//
// I rolled it back on my own judgement and told the owner afterwards. THAT WAS
// NOT MINE TO DECIDE. Whether a sign-in method is offered to users is a
// product decision, and the first rule in CLAUDE.md is that those belong to the
// owner. A feature the owner chose to ship, breaking, is theirs to withdraw —
// my job was to report and to fix, not to revert them and inform them after.
//
// THE ROLLBACK WAS ALSO USELESS IN PRACTICE, which is the part worth keeping.
// `phoneLoginVisible`'s `?phone=1` escape hatch cannot be reached inside the
// Capacitor WebView: there is no address bar to type a query string into. So a
// canary built to keep the flow testable made it UNTESTABLE in the only
// environment where the bug reproduces, and left the owner staring at an auth
// screen with no phone option at all. A fallback that needs a URL bar is not a
// fallback for an app.
//
// WHAT THE FAILURE IS NOT, ruled out by measurement rather than by guessing:
//
//   the web config          the phone tab RENDERED, so FIREBASE_WEB.configured
//                           is true and all six VITE_FIREBASE_* inlined
//   the authorized domain   capacitor.config.json loads https://oniqhub.com
//                           with androidScheme https, so the WebView origin IS
//                           the apex, which IS on authorizedDomains
//   the www host            www.oniqhub.com 302s to the apex before any
//                           Firebase call runs (measured, not assumed)
//   the region or provider  a server-side sendVerificationCode still reaches
//                           MISSING_CLIENT_IDENTIFIER, i.e. past both checks
//   the server chain        proven end to end with a test number, right down
//                           to a real Supabase session
//
// `auth/internal-error` is the SDK's catch-all for an unexpected response from
// Identity Toolkit, so the cause is in the server response the SDK swallowed.
// `firebaseErrorDetail` in firebasePhoneOtp.ts now unwraps and surfaces it, so
// the NEXT attempt names the fault instead of repeating "internal error".
//
// Leading candidates, none yet measured, in the order worth checking:
//   1. API key restrictions. A server call carries no Referer and succeeds; a
//      browser call sends one. An HTTP-referrer restriction on the web key that
//      omits oniqhub.com would break exactly the browser and nothing else.
//   2. App Check. If it was enforced for Authentication during the console
//      pass, nothing here registers an App Check provider, so every call from
//      the client is unattested.
//   3. The WebView itself — reCAPTCHA runs in an iframe on the authDomain and
//      can fail under an embedded WebView's storage rules. Trying the same
//      page in Chrome on the phone separates this from 1 and 2 for free.
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
// STILL BROKEN, AND DELIBERATELY LEFT ON. `get otp` fails; that is the owner's
// accepted risk and not a state for an agent to quietly correct. What changed
// since the failure is that `firebaseErrorDetail` unwraps the server's own
// message, so the next attempt names the fault instead of repeating Firebase's
// catch-all — and diagnosing it at all requires the tab to be reachable, which
// in the Android app means this flag and nothing else.
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

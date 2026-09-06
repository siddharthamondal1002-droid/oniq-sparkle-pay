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
// WHAT FLIPS THIS IS A DELIVERED SMS, NOT A GREEN BUILD. Firebase's test phone
// numbers (Authentication -> Sign-in method -> Phone -> numbers for testing)
// run the whole real flow with a fixed code and send nothing, so proving it
// costs nothing. Prove it there first, then on one real handset, then flip.
export const OTP_LOGIN_ENABLED = false;

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

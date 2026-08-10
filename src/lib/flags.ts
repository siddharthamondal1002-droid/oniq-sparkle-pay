// Audio/video calls, on Metered.ca managed TURN. The original blocker — the
// decommissioned openrelay project hanging every call on "Connecting…" — is
// gone: `get-turn-credentials` fetches managed credentials server-side and the
// client REFUSES to start a call unless the response says source:"metered"
// with real turn:/turns: URLs (IceUnavailableError → clear toast, never a
// hang). So the failure mode this flag guarded against no longer exists; if
// the METERED_* secrets ever lapse, calls degrade to an honest error, not to
// silence.
export const CALLS_ENABLED = true;

// Master kill-switch for phone/OTP login. When true, the phone tab still
// only appears once the OTP provider reports ready (get-otp-config), so
// users never see a dead-end path while MSG91 credentials are missing.
// Off while MSG91 delivery is being sorted out (MSG91 account credits / WhatsApp
// channel setup). All app-side wiring is done and verified — flip back to
// true once codes actually deliver.
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

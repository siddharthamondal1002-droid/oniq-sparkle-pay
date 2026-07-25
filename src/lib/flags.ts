// Calls dormant pending self-hosted TURN (coturn) — flip to true to re-enable.
export const CALLS_ENABLED = false;

// Master kill-switch for phone/OTP login. When true, the phone tab still
// only appears once the OTP provider reports ready (get-otp-config), so
// users never see a dead-end path while MSG91 credentials are missing.
export const OTP_LOGIN_ENABLED = true;

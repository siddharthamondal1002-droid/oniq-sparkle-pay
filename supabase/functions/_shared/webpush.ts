/**
 * Web Push — the browser half of ONIQ's notifications.
 *
 * WHY THIS EXISTS. Measured 2026-08-14: 101 accounts, 14 with a push token
 * ever, 4 refreshed in a week. Six of the nine people called that day had no
 * token at all, so `send-push` addressed nothing and returned
 * {"sent":0,"failed":0} — a 200 with silence inside it. The cause was not FCM:
 * `initPush()` returned "unavailable" on the first line unless Capacitor said
 * native, and there was no `pushManager`, no VAPID key and no `push` listener
 * in the service worker. Everyone on oniqhub.com was unreachable by design.
 * This module is the missing half.
 *
 * NO LIBRARY, ON PURPOSE. `web-push` is Node-shaped (node:crypto, node:https)
 * and does not port cleanly into a Deno edge function. Everything below is
 * WebCrypto, which Deno has natively, so there is no dependency to break at
 * deploy time and no vendored code to audit. It is three RFCs and they are
 * short:
 *
 *   RFC 8291 — the ECDH + HKDF that turns a subscription's public key and
 *              auth secret into a content key ONLY that browser can derive.
 *   RFC 8188 — the aes128gcm content encoding and its record framing.
 *   RFC 8292 — the VAPID JWT that identifies this server to the push service.
 *
 * THE PAYLOAD IS ENCRYPTED END TO END and the push service (Google, Mozilla,
 * Apple) cannot read it. That is not a nicety here: these payloads carry who
 * is calling whom.
 */

/** A browser's PushSubscription, as `subscription.toJSON()` hands it over. */
export type WebPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type WebPushResult =
  | { ok: true; status: number }
  /**
   * `gone` means the subscription is dead and the row should be deleted.
   *
   * `vapidMismatch` is the push service telling us, in its own words, that
   * this subscription was minted against a DIFFERENT application server key.
   * That is evidence, not inference: it is the one 403 whose meaning is not
   * "try again later" but "this address can never accept anything we sign".
   */
  | { ok: false; status: number; gone: boolean; vapidMismatch: boolean; error: string };


// ---------------------------------------------------------------------------
// base64url. The push API speaks it everywhere and never pads.
// ---------------------------------------------------------------------------

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// HKDF, spelled out.
//
// Deno's crypto.subtle does support HKDF via deriveBits, but only with a
// FIXED info per call and an awkward key import dance; RFC 8291 needs three
// derivations with three different infos off two different salts. HMAC is one
// primitive and the whole construction is four lines, so it is written out —
// and every output here is <= 32 bytes, which is exactly the single-block case
// of HKDF-Expand (T(1) = HMAC(PRK, info || 0x01)).
// ---------------------------------------------------------------------------

async function hmac(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, msg as unknown as ArrayBuffer));
}

/** HKDF-Extract, which is just HMAC with the salt as the key. */
const extract = (salt: Uint8Array, ikm: Uint8Array) => hmac(salt, ikm);

/** HKDF-Expand for one block. `length` must be <= 32. */
async function expand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t = await hmac(prk, concat(info, new Uint8Array([1])));
  return t.slice(0, length);
}

const utf8 = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------------------
// RFC 8291 §3.4 + RFC 8188 §2 — encrypt one payload for one subscription.
// ---------------------------------------------------------------------------

/**
 * The aes128gcm body for `payload`, addressed to `sub`.
 *
 * Returns the complete request body: the RFC 8188 header (salt, record size,
 * and this server's throwaway public key) followed by one AEAD record. A fresh
 * ECDH keypair is generated per message — reusing one would let a push service
 * link two messages to the same sender across subscriptions.
 */
export async function encryptPayload(
  sub: WebPushSubscription,
  payload: string,
  /**
   * The per-message randomness, injectable ONLY so the RFC 8291 §5 test
   * vector can be reproduced byte for byte. Nothing in production passes it.
   * A wrong implementation here fails silently and identically for every
   * subscriber — the push service accepts the POST and the browser quietly
   * discards what it cannot decrypt — so this seam is the difference between
   * "verified" and "hoped".
   */
  fixed?: { salt: Uint8Array; keyPair: CryptoKeyPair },
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.keys.p256dh); // 65 bytes, uncompressed
  const authSecret = b64urlToBytes(sub.keys.auth); // 16 bytes

  const as =
    fixed?.keyPair ??
    (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic as unknown as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256),
  );

  // RFC 8291 §3.3. The key_info binds the derived secret to BOTH public keys,
  // so a payload encrypted for one subscriber cannot be replayed at another.
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await expand(await extract(authSecret, shared), keyInfo, 32);

  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await extract(salt, ikm);
  const cek = await expand(
    prk,
    concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])),
    16,
  );
  const nonce = await expand(prk, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // RFC 8188 §2: a record's plaintext ends with a delimiter — 0x02 marks the
  // last record. Ours is always the last, because we send exactly one.
  const plaintext = concat(utf8(payload), new Uint8Array([2]));
  const aes = await crypto.subtle.importKey(
    "raw",
    cek as unknown as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as unknown as ArrayBuffer, tagLength: 128 },
      aes,
      plaintext as unknown as ArrayBuffer,
    ),
  );

  // header = salt(16) || record_size(4, big-endian) || idlen(1) || keyid
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

// ---------------------------------------------------------------------------
// RFC 8292 — VAPID.
// ---------------------------------------------------------------------------

/**
 * The application server's identity keypair.
 *
 * Held as a JWK because one JWK carries BOTH halves: `d` signs, and `x`/`y`
 * are the public point the browser must pin at subscribe time. Deriving a
 * public key back out of a PKCS#8 blob is not something WebCrypto will do, so
 * a PEM secret would have forced a second secret for the public half and a
 * standing chance of the two drifting apart. One secret, no drift.
 */
export type VapidJwk = {
  kty: "EC";
  crv: "P-256";
  d: string;
  x: string;
  y: string;
};

export function parseVapidJwk(raw: string): VapidJwk {
  const jwk = JSON.parse(raw) as Partial<VapidJwk>;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error("VAPID_PRIVATE_KEY is not a P-256 private JWK");
  }
  return jwk as VapidJwk;
}

/** The uncompressed public point, base64url — what a browser subscribes with. */
export function vapidPublicKey(jwk: VapidJwk): string {
  return bytesToB64url(concat(new Uint8Array([4]), b64urlToBytes(jwk.x), b64urlToBytes(jwk.y)));
}

/** `https://fcm.googleapis.com/…` -> `https://fcm.googleapis.com`. The `aud`. */
function audienceOf(endpoint: string): string {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

/**
 * The `Authorization: vapid …` header value for one push service.
 *
 * Signed per audience rather than once per batch: the JWT's `aud` is the push
 * SERVICE, so a token minted for Google's endpoint is rejected by Mozilla's.
 * Callers cache these per audience for the life of one invocation.
 */
export async function vapidAuthHeader(
  jwk: VapidJwk,
  endpoint: string,
  subject: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "jwk",
    { ...jwk, key_ops: ["sign"], ext: false },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = bytesToB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // Twelve hours. The spec's ceiling is 24 and some services reject anything
  // at or past it, so the safe half is used rather than the legal maximum.
  const claims = {
    aud: audienceOf(endpoint),
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  };
  const body = bytesToB64url(utf8(JSON.stringify(claims)));
  const signingInput = utf8(`${header}.${body}`);
  // WebCrypto ECDSA emits the raw r||s pair that JWS ES256 wants — no DER
  // unwrapping, which is the usual trap when porting this off Node.
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signingInput as unknown as ArrayBuffer,
    ),
  );
  return `vapid t=${header}.${body}.${bytesToB64url(sig)}, k=${vapidPublicKey(jwk)}`;
}

// ---------------------------------------------------------------------------
// The send.
// ---------------------------------------------------------------------------

/**
 * Deliver one encrypted payload to one subscription.
 *
 * `gone` is the only signal a caller may delete a row on, and it is set for
 * exactly the two statuses that mean the subscription itself is finished —
 * 404 (never existed) and 410 (unsubscribed). Everything else, including 429
 * and any 5xx, leaves the row alone: a push service having a bad minute is
 * not evidence that a user uninstalled anything. This mirrors the deliberate
 * narrowness of the FCM path's stale-token rule.
 */
export async function sendWebPush(
  sub: WebPushSubscription,
  payload: string,
  opts: { jwk: VapidJwk; subject: string; ttlSeconds: number; urgency?: "high" | "normal" },
): Promise<WebPushResult> {
  try {
    const body = await encryptPayload(sub, payload);
    const auth = await vapidAuthHeader(opts.jwk, sub.endpoint, opts.subject);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(opts.ttlSeconds),
        Urgency: opts.urgency ?? "normal",
      },
      body: body as unknown as BodyInit,
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    // Every service words it differently — FCM's web endpoint says "the VAPID
    // credentials ... do not correspond", Mozilla says VapidPkHashMismatch —
    // so match on either, and only ever on a 403.
    const vapidMismatch =
      res.status === 403 &&
      /vapid\s*(credentials|pk)|VapidPkHashMismatch|do not correspond/i.test(text);
    return {
      ok: false,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      vapidMismatch,
      error: text.slice(0, 200),
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      gone: false,
      vapidMismatch: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}


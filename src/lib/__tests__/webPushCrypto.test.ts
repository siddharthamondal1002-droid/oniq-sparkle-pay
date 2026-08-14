/**
 * The Web Push encryption, against RFC 8291's own test vector.
 *
 * WHY A VECTOR AND NOT A ROUND TRIP. A wrong aes128gcm implementation fails
 * SILENTLY: the push service accepts the POST (it never reads the body), and
 * the browser drops what it cannot decrypt without telling anyone. There is no
 * error anywhere in the chain to notice. A round-trip test written against my
 * own code would agree with my own mistakes, so the only honest check is the
 * bytes the RFC says must come out.
 *
 * Vector: RFC 8291 §5, "When I grow up, I want to be a watermelon".
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  b64urlToBytes,
  bytesToB64url,
  encryptPayload,
  parseVapidJwk,
  vapidAuthHeader,
  vapidPublicKey,
} from "../../../supabase/functions/_shared/webpush";

// --- RFC 8291 §5 ------------------------------------------------------------
const PLAINTEXT = "When I grow up, I want to be a watermelon";
const UA_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const AS_PRIVATE_D = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const AS_PUBLIC =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const SALT = "DGv6ra1nlYgDCS1FRnbzlw";
/** The receiver's private key — used below to decrypt, never by the sender. */
const UA_PRIVATE_D = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94";
const EXPECTED =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

/** The sender's fixed keypair, rebuilt as a JWK from the vector's raw bytes. */
async function senderKeyPair(): Promise<CryptoKeyPair> {
  const pub = b64urlToBytes(AS_PUBLIC);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: AS_PRIVATE_D,
    ext: true,
  };
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const publicKey = await crypto.subtle.importKey(
    "raw",
    pub as unknown as ArrayBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
  return { privateKey, publicKey };
}

describe("RFC 8291 content encryption", () => {
  it("reproduces the specification's body byte for byte", async () => {
    const body = await encryptPayload(
      { endpoint: "https://example.test/x", keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET } },
      PLAINTEXT,
      { salt: b64urlToBytes(SALT), keyPair: await senderKeyPair() },
    );
    expect(bytesToB64url(body)).toBe(EXPECTED);
  });

  it("frames the header exactly as RFC 8188 requires", async () => {
    const body = await encryptPayload(
      { endpoint: "https://example.test/x", keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET } },
      PLAINTEXT,
      { salt: b64urlToBytes(SALT), keyPair: await senderKeyPair() },
    );
    expect(bytesToB64url(body.slice(0, 16)), "salt is not first").toBe(SALT);
    // record size, big-endian uint32
    expect(new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false)).toBe(4096);
    expect(body[20], "key id length byte").toBe(65);
    expect(bytesToB64url(body.slice(21, 86)), "sender key is not in the header").toBe(AS_PUBLIC);
    // plaintext + 0x02 delimiter, + 16-byte GCM tag
    expect(body.length - 86).toBe(PLAINTEXT.length + 1 + 16);
  });

  /**
   * The check that is not circular.
   *
   * Matching a constant proves the bytes agree with what I transcribed;
   * decrypting proves the browser can actually READ them. This runs the
   * receiver's side of RFC 8291 with the vector's UA private key — derived
   * independently, and deliberately NOT sharing the sender's HKDF code — and
   * the plaintext either comes back or it does not.
   */
  it("produces a body the intended recipient can decrypt", async () => {
    const body = await encryptPayload(
      { endpoint: "https://example.test/x", keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET } },
      PLAINTEXT,
      { salt: b64urlToBytes(SALT), keyPair: await senderKeyPair() },
    );

    const salt = body.slice(0, 16);
    const asPublic = body.slice(21, 86);
    const ciphertext = body.slice(86);

    const uaPub = b64urlToBytes(UA_PUBLIC);
    const uaPrivate = await crypto.subtle.importKey(
      "jwk",
      {
        kty: "EC",
        crv: "P-256",
        x: bytesToB64url(uaPub.slice(1, 33)),
        y: bytesToB64url(uaPub.slice(33, 65)),
        d: UA_PRIVATE_D,
        ext: true,
      },
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const asKey = await crypto.subtle.importKey(
      "raw",
      asPublic as unknown as ArrayBuffer,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256),
    );

    const mac = async (key: Uint8Array, msg: Uint8Array) =>
      new Uint8Array(
        await crypto.subtle.sign(
          "HMAC",
          await crypto.subtle.importKey(
            "raw",
            key as unknown as ArrayBuffer,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          ),
          msg as unknown as ArrayBuffer,
        ),
      );
    const bytes = (...xs: Uint8Array[]) => {
      const out = new Uint8Array(xs.reduce((n, x) => n + x.length, 0));
      let at = 0;
      for (const x of xs) {
        out.set(x, at);
        at += x.length;
      }
      return out;
    };
    const enc = (s: string) => new TextEncoder().encode(s);
    const one = new Uint8Array([1]);
    const nul = new Uint8Array([0]);

    const keyInfo = bytes(enc("WebPush: info"), nul, uaPub, asPublic);
    const ikm = (
      await mac(await mac(b64urlToBytes(AUTH_SECRET), shared), bytes(keyInfo, one))
    ).slice(0, 32);
    const prk = await mac(salt, ikm);
    const cek = (await mac(prk, bytes(enc("Content-Encoding: aes128gcm"), nul, one))).slice(0, 16);
    const nonce = (await mac(prk, bytes(enc("Content-Encoding: nonce"), nul, one))).slice(0, 12);

    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce as unknown as ArrayBuffer, tagLength: 128 },
        await crypto.subtle.importKey(
          "raw",
          cek as unknown as ArrayBuffer,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        ),
        ciphertext as unknown as ArrayBuffer,
      ),
    );
    expect(plain[plain.length - 1], "missing RFC 8188 last-record delimiter").toBe(2);
    expect(new TextDecoder().decode(plain.slice(0, -1))).toBe(PLAINTEXT);
  });

  it("uses fresh randomness when none is injected", async () => {
    const sub = {
      endpoint: "https://example.test/x",
      keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET },
    };
    const a = bytesToB64url(await encryptPayload(sub, PLAINTEXT));
    const b = bytesToB64url(await encryptPayload(sub, PLAINTEXT));
    expect(a).not.toBe(b);
    expect(a).not.toBe(EXPECTED);
  });
});

describe("base64url", () => {
  it("round-trips every byte value without padding", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    const s = bytesToB64url(all);
    expect(s).not.toMatch(/[+/=]/);
    expect(Array.from(b64urlToBytes(s))).toEqual(Array.from(all));
  });

  it("accepts input that would need padding", () => {
    // 16 bytes -> 22 chars, which is 2 short of a multiple of 4.
    expect(b64urlToBytes(AUTH_SECRET).length).toBe(16);
    expect(b64urlToBytes(UA_PUBLIC).length).toBe(65);
  });
});

describe("RFC 8292 VAPID", () => {
  const jwk = {
    kty: "EC" as const,
    crv: "P-256" as const,
    d: AS_PRIVATE_D,
    x: bytesToB64url(b64urlToBytes(AS_PUBLIC).slice(1, 33)),
    y: bytesToB64url(b64urlToBytes(AS_PUBLIC).slice(33, 65)),
  };

  it("derives the subscribe-time public key from the private JWK alone", () => {
    // The whole reason the secret is a JWK: one value yields both halves, so
    // the key the browser pins can never drift from the key that signs.
    expect(vapidPublicKey(jwk)).toBe(AS_PUBLIC);
  });

  it("refuses a key that is not a P-256 private JWK", () => {
    expect(() => parseVapidJwk(JSON.stringify({ kty: "RSA" }))).toThrow(/P-256 private JWK/);
    expect(() => parseVapidJwk(JSON.stringify({ ...jwk, d: undefined }))).toThrow();
    expect(() => parseVapidJwk("not json")).toThrow();
  });

  it("signs a verifiable ES256 token scoped to the push service", async () => {
    const header = await vapidAuthHeader(
      jwk,
      "https://fcm.googleapis.com/fcm/send/abc123",
      "mailto:hello@oniqhub.com",
    );
    const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header);
    expect(m, "header shape is not `vapid t=…, k=…`").not.toBeNull();
    const [, jwt, k] = m!;
    expect(k).toBe(AS_PUBLIC);

    const [h, b, s] = jwt.split(".");
    expect(JSON.parse(new TextDecoder().decode(b64urlToBytes(h)))).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(b)));
    // The aud is the SERVICE origin, never the full endpoint — a token minted
    // for one push service is rejected by another.
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("mailto:hello@oniqhub.com");
    const life = claims.exp - Math.floor(Date.now() / 1000);
    expect(life).toBeGreaterThan(11 * 3600);
    expect(life, "past the spec's 24h ceiling").toBeLessThan(24 * 3600);

    // Verify the signature for real, with the public half only.
    const pub = await crypto.subtle.importKey(
      "raw",
      b64urlToBytes(AS_PUBLIC) as unknown as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      b64urlToBytes(s) as unknown as ArrayBuffer,
      new TextEncoder().encode(`${h}.${b}`) as unknown as ArrayBuffer,
    );
    expect(ok, "ES256 signature does not verify").toBe(true);
  });
});

/**
 * The wiring, pinned.
 *
 * The crypto above can be perfect while the feature is still dead — a missing
 * `push` listener, a send-push that posts endpoints to FCM, or an initPush
 * that still bails on its first line all produce the same symptom as before:
 * silence, and a 200 that says everything is fine. These assert the chain
 * exists, in the same spirit as the story-plot wiring pins.
 */
describe("the web push wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("gives the service worker somewhere to receive", () => {
    const sw = read("public/sw.js");
    expect(sw, "no push listener — the browser has nothing to deliver to").toContain(
      'addEventListener("push"',
    );
    expect(sw).toContain("showNotification");
    // A cancel must retract, never announce.
    expect(sw).toContain('d.kind === "call_cancel"');
    expect(sw).toContain("getNotifications");
    expect(sw, "endpoints can be retired by the push service").toContain(
      'addEventListener("pushsubscriptionchange"',
    );
  });

  it("routes the browser to a subscription instead of bailing out", () => {
    const push = read("src/lib/push.ts");
    expect(push).toContain("subscribeWebPush");
    // The old first line — `if (!isNativePlatform()) return "unavailable"` —
    // must not come back; that single statement was the whole outage.
    expect(
      /isNativePlatform\(\)\)\s*return\s*"unavailable"/.test(push),
      "initPush bails on web again — web users get no push address",
    ).toBe(false);
    expect(push, "sign-out must drop the browser subscription too").toContain(
      "unsubscribeWebPush()",
    );
  });

  it("keeps the two transports apart in send-push", () => {
    const fn = read("supabase/functions/send-push/index.ts");
    expect(fn).toContain('select("token, platform, keys")');
    // Posting an endpoint URL to FCM fails; posting an FCM token to a push
    // service is not even a request.
    expect(fn).toContain('r.platform !== "web"');
    expect(fn).toContain('r.platform === "web"');
    expect(fn).toContain("sendWebPush");
    // The blind spot that hid this: zero recipients must be audible.
    expect(fn).toContain("no push address for any of");
    // One transport's payload fault must not wipe the other's rows.
    expect(fn).toContain("wipedFcm");
    expect(fn).toContain("wipedWeb");
  });

  it("derives the client's key from the server's single secret", () => {
    const keyFn = read("supabase/functions/push-key/index.ts");
    expect(keyFn).toContain("vapidPublicKey");
    expect(keyFn).toContain("VAPID_PRIVATE_KEY");
    const client = read("src/lib/webPush.ts");
    expect(client, "the VAPID key must be fetched, never hardcoded").toContain(
      'supabase.functions.invoke("push-key")',
    );
    expect(client).toContain("userVisibleOnly: true");
  });

  it("stores web key material where the sender will look for it", () => {
    const sql = read("supabase/migrations/20260814180000_web_push.sql");
    expect(sql).toContain("add column if not exists keys jsonb");
    // A web row missing either half can never be encrypted for.
    expect(sql).toContain("keys ? 'p256dh'");
    expect(sql).toContain("keys ? 'auth'");
  });
});

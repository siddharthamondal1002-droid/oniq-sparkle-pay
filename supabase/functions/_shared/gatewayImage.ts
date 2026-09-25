// gatewayImage — the Lovable-gateway image engine, restored.
//
// OWNER DIRECTIVE, 2026-09-01 (stills return to the gateway; no GPU in the
// still path). The owner asked for "the old version back where in-house and
// Veo both was there without gpu" — the 14–27 August shape: stills drawn
// through ai.gateway.lovable.dev on LOVABLE_API_KEY, motion either ONIQ's own
// Remotion Ken Burns (classic) or Veo (movie). That SUPERSEDES the 2026-08-27
// fully-in-house directive for the STILL stage only.
//
// WHY, plainly: the RunPod worker has not drawn a frame on this configuration.
// Both films on 2026-09-01 died at `still 1` — the endpoint reported
// `initializing: 1, ready: 0` for the whole 25-minute wait, so the image pull
// never finished and no GPU seconds were ever spent on drawing. Veo is
// image-to-video and needs a starting frame, so while stills cannot be drawn
// NO story completes on any motion setting. This is the stage that unblocks
// everything downstream of it.
//
// WHOSE MONEY. Lovable credits — the same pool story-voice and translate
// already spend, and not the metered Google key. That is the point of naming
// it here: the 2026-08-09 incident this repo's CLAUDE.md opens with was a
// provider-and-payment choice made silently inside code. This one is the
// owner's, dated, and recorded next to the code it governs.
//
// NO SILENT FALLBACK, IN EITHER DIRECTION. The 2026-08-27 directive's real
// content was that a stage which can quietly outsource is worse than a stage
// that fails — and that survives intact. story-still picks ONE engine from
// STILL_PROVIDER before it calls anything; if the chosen engine is not
// configured the request FAILS, and the other engine is never tried. See
// stillRoute.ts, which is the whole of that decision and is pure so it can be
// tested rather than reasoned about.

import { providerReceiptFrom, withGatewayCostCapture, type GatewayRpc } from "./gatewayLedger.ts";

/** Where the gateway serves images. */
export const GATEWAY_IMAGE_URL = "https://ai.gateway.lovable.dev/v1/images/generations";

/**
 * The model. Mirrored in modelRegistry.ts as IMAGE_STILL_GATEWAY — the
 * registry is the place that carries lifecycle and capability, this constant
 * is what goes on the wire.
 *
 * MOVED 2026-09-04 from `google/gemini-2.5-flash-image` by owner directive:
 * "Nano Banana 2" is the owner's name for it, `google/gemini-3.1-flash-image`
 * is the id the gateway answers to. Google had already marked the 2.5 image
 * model legacy and recommended the move (GOOGLE_AI_RESEARCH.md), and
 * ENGINE_AUDIT.md carried "does the image stage migrate off Nano Banana?" as
 * an open question; this is the answer to it.
 *
 * POST-VERIFIED before it was written here, because a listing is not proof —
 * see the measured 404 table in llm.ts for the model that sat in ListModels
 * and failed every real call. Measured on the gateway, this body shape:
 *
 *   google/gemini-3.1-flash-image       200, b64_json image returned
 *                                       usage {input 3, output 1120}
 *   google/gemini-3.1-flash-lite-image  400 upstream_error — routed, but
 *                                       rejects `prompt`/`modalities`
 *
 * The lite tier is therefore NOT wired here. It exists and the gateway routes
 * it, but it wants a different envelope, and a cheaper image that 400s is not
 * cheaper. See IMAGE_STILL_GATEWAY_LITE in the registry.
 */
export const GATEWAY_IMAGE_MODEL = "google/gemini-3.1-flash-image";

/**
 * Portrait, matching the episode pipeline. The aspect rides IN THE PROMPT
 * rather than in a request field, because this endpoint takes no size
 * parameter, and the composition's objectFit: cover crops any drift rather
 * than breaking.
 */
export const ASPECT_SUFFIX = "\n\nVertical 9:16 portrait composition, full-bleed.";

/**
 * Cap on an inlined reference. The owner character frames are ~1.4 MB PNGs
 * (~1.9 MB once base64'd); 12 MB is generous headroom for those while still
 * refusing a payload that could only be an abuse. Checked against
 * content-length BEFORE the body is read, then against the bytes actually
 * received — a header is a claim, not a bound.
 */
export const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;

/**
 * What a caller may send THIS engine.
 *
 * Deliberately NOT oniqImage's MAX_ASK_CHARS. That number is the GPU
 * worker's own contract ceiling (contract.py, 1000), mirrored on both ends so
 * the two cannot drift; it is a property of that engine and of nothing else.
 * The gateway took 2000 for the whole of the 2026-08-14 era and still does.
 *
 * Holding the smaller number here would cost real quality for no reason: the
 * worker's ask ladder reads a 422 as "this content was refused, step down",
 * so a perfectly drawable 1400-character shot would be demoted to a blander
 * one against an engine that would have drawn it.
 */
export const MAX_GATEWAY_ASK_CHARS = 2000;

/** How long one gateway draw may take before it is abandoned. */
export const GATEWAY_TIMEOUT_MS = 60_000;

/**
 * What went wrong, in terms the caller can route on.
 *
 * `kind` exists because the four failures mean four different things to the
 * Story worker's ask ladder, and an English message is not an API:
 *
 *   unconfigured  the key is missing or rejected      -> configured:false
 *   credits       the pool ran dry / rate limited     -> retry later, same ask
 *   upstream      the gateway itself failed           -> retry, same ask
 *   refused       200 with no image part              -> step the ASK down
 *
 * Conflating the last two is the specific bug the old file called out: a
 * caller that reads "refused" for a credit exhaustion rewrites a perfectly
 * good prompt into a blander one and still gets nothing.
 */
export type GatewayFailure = "unconfigured" | "credits" | "upstream" | "refused" | "timeout";

export class GatewayError extends Error {
  readonly kind: GatewayFailure;
  readonly retryable: boolean;
  constructor(kind: GatewayFailure, message: string) {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
    // A refusal repeats exactly; everything else can come good on its own.
    this.retryable = kind !== "refused" && kind !== "unconfigured";
  }
}

export type GatewayEnv = { key: string };
export type GatewayDeps = { fetchImpl: typeof fetch };
export type GatewayStill = { mime: string; data: string };

export type GatewayOpts = {
  /**
   * Terms to keep OUT of the frame. The gateway takes no negative-prompt
   * field, so they ride in the ask as a sentence — reported to the caller as
   * `negativeApplied: "prompt-text"` so nobody reads a per-shot negative as
   * having been enforced the way the in-house sampler enforces one.
   */
  negativePrompt?: string;
  /**
   * An inlined `data:image/*;base64,` reference. NEVER an http(s) URL: the
   * frame is fetched by THIS side from ONIQ's own bucket and handed over as
   * bytes, so the model is never asked to crawl a URL and no caller-supplied
   * host is ever reachable. Vertex rejects a URL anyway (URL_REJECTED).
   */
  referenceDataUrl?: string;
  timeoutMs?: number;
  /**
   * CREDIT ACCOUNTING, opt-in. Absent ⇒ nothing is recorded and the call is
   * byte-for-byte what it was before — a still drawn by a caller that has no
   * database reach must not fail for want of a ledger. Present ⇒ the attempt
   * is captured before the request and settled after it, in CREDITS, in
   * `gateway_spend_ledger`. Never in dollars: see gatewayLedger.ts.
   */
  spend?: GatewaySpendBinding;
};

/** What a caller must know to book its own gateway draw. */
export type GatewaySpendBinding = {
  rpc: GatewayRpc | null;
  /** Stable per ATTEMPT — a retried frame is a new id, not the same one. */
  requestId: string;
  jobId?: string | null;
  attempt?: number | null;
  userId?: string | null;
};

/** The shape a reference must have before it may be inlined. */
export const REFERENCE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/i;

/**
 * The ask as it goes on the wire: the prompt verbatim, the aspect sentence,
 * and the negative terms if any. Pure, so the composition is testable without
 * a network.
 */
export function composeAsk(prompt: string, negativePrompt?: string): string {
  const negative = (negativePrompt ?? "").trim();
  return negative
    ? `${prompt}${ASPECT_SUFFIX}\n\nDo not include: ${negative}.`
    : `${prompt}${ASPECT_SUFFIX}`;
}

/**
 * One still, drawn by the gateway.
 *
 * Synchronous by nature — a draw is one request measured in seconds, not the
 * minutes a cold GPU needs — which is why there is no start/poll pair here.
 * story-still's `start` answers with the finished frame and the worker takes
 * it without polling.
 */
export async function drawStillViaGateway(
  prompt: string,
  env: GatewayEnv,
  deps: GatewayDeps,
  opts: GatewayOpts = {},
): Promise<GatewayStill> {
  // PREFLIGHT BEFORE THE CAPTURE, deliberately. A malformed or oversized
  // reference is refused by THIS side and never reaches the gateway, so
  // capturing it first would write a row for an attempt that was never made —
  // and that row would then settle FAILED, over-counting a request the
  // provider never saw. Local refusals leave no row at all.
  assertReferenceUsable(opts.referenceDataUrl);
  const spend = opts.spend;
  if (!spend) return (await drawStillOnGateway(prompt, env, deps, opts)).still;
  return withGatewayCostCapture(
    spend.rpc,
    {
      requestId: spend.requestId,
      capability: "IMAGE",
      model: GATEWAY_IMAGE_MODEL,
      unit: "images",
      jobId: spend.jobId ?? null,
      attempt: spend.attempt ?? null,
      userId: spend.userId ?? null,
      detail: { conditioned: Boolean((opts.referenceDataUrl ?? "").trim()) },
    },
    async () => {
      // ONE image is the unit, and the gateway discloses no price for it —
      // so `chargedCredits` stays absent and the row settles
      // PENDING_RECONCILIATION rather than claiming the draw was free.
      const drawn = await drawStillOnGateway(prompt, env, deps, opts);
      return {
        value: drawn.still,
        outcome: "ACCEPTED" as const,
        unitsObserved: 1,
        providerReceiptId: drawn.receiptId,
      };
    },
  );
}

/** The two local refusals, hoisted so they can run before any row is written. */
export function assertReferenceUsable(referenceDataUrl?: string): void {
  const ref = (referenceDataUrl ?? "").trim();
  if (ref && !REFERENCE_DATA_URL.test(ref)) {
    // Not a caller error by the time it reaches here — this side built it —
    // so it is a bug, and it fails loudly rather than drawing unconditioned.
    throw new GatewayError("upstream", "reference is not an inlined data:image URL");
  }
  if (ref.length > MAX_REFERENCE_BYTES) {
    throw new GatewayError("upstream", "reference is too large to inline");
  }
}

/**
 * The draw itself. A throw from here settles FAILED rather than NOT_CALLED:
 * once the fetch has been made, the request may have been served and charged
 * whatever this side managed to read back.
 */
async function drawStillOnGateway(
  prompt: string,
  env: GatewayEnv,
  deps: GatewayDeps,
  opts: GatewayOpts = {},
): Promise<{ still: GatewayStill; receiptId: string | null }> {
  const ref = (opts.referenceDataUrl ?? "").trim();

  const ask = composeAsk(prompt, opts.negativePrompt);
  // Multimodal content only when a reference rode along; otherwise the exact
  // text-only shape the pipeline sent for the whole of the gateway era, so an
  // unconditioned still is byte-for-byte the previous behaviour.
  const content = ref
    ? [
        { type: "text", text: ask },
        { type: "image_url", image_url: { url: ref } },
      ]
    : ask;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? GATEWAY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await deps.fetchImpl(GATEWAY_IMAGE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${env.key}`,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: GATEWAY_IMAGE_MODEL,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new GatewayError("timeout", "the gateway did not answer in time");
    }
    throw new GatewayError("upstream", `gateway unreachable (${String(err)})`);
  } finally {
    clearTimeout(timer);
  }

  // THE STATUS RIDES ON THE THROW. `withGatewayCostCapture` reads a numeric
  // `status` off the error and records that number and nothing else — the
  // upstream's own text stays in the message, which goes to the worker's log
  // and never into a ledger row.
  //
  // SO DOES THE RECEIPT. A 402, a 500 or a 200-with-no-image all REACHED the
  // gateway, and the id it set on that response is the only handle a
  // reconciliation has on whatever it charged. Reading it only on success is
  // how the charges that most need tracing are the ones with no trace.
  const withStatus = (e: GatewayError): GatewayError => {
    const tagged = e as GatewayError & { status?: number; providerReceiptId?: string | null };
    tagged.status = res.status;
    tagged.providerReceiptId = providerReceiptFrom(null, res.headers);
    return e;
  };

  if (res.status === 401 || res.status === 403) {
    throw withStatus(new GatewayError("unconfigured", "the gateway rejected the credential"));
  }
  // The pool itself running dry is ITS OWN failure, named plainly: the
  // worker's log must say "credits", not "the model refused the frame".
  if (res.status === 402 || res.status === 429) {
    const detail = await res.text().catch(() => "");
    throw withStatus(
      new GatewayError(
        "credits",
        `image credits exhausted or rate limited (${res.status} ${detail.slice(0, 200)})`,
      ),
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw withStatus(new GatewayError("upstream", `gateway ${res.status} ${detail.slice(0, 300)}`));
  }

  const data = await res.json().catch(() => ({}));
  const image = firstImage(data);
  // The receipt is read from what the gateway actually returned — its own id,
  // or a request id it set on the response. Never synthesised.
  if (image) return { still: image, receiptId: providerReceiptFrom(data, res.headers) };

  // A refusal comes back as a 200 with no image part rather than an error
  // status, so "ok but empty" has to be treated as a failure here or the
  // caller stores an undefined and finds out at assembly. The WHY rides out
  // with it: the worker retries refused frames down a ladder of safer
  // prompts, and a bare "refused" left it guessing whether the trigger was
  // the wording, the safety filter, or the prompt being blocked outright.
  throw withStatus(
    new GatewayError("refused", `no image part (${refusalReason(data) || "unstated"})`),
  );
}

/** Why the gateway answered 200 without an image, as far as it said. */
export function refusalReason(data: unknown): string {
  const d = data as { choices?: { finish_reason?: string; message?: { content?: string } }[] };
  return [d?.choices?.[0]?.finish_reason, (d?.choices?.[0]?.message?.content ?? "").slice(0, 120)]
    .filter(Boolean)
    .join("/");
}

/**
 * The first image in a gateway reply, if there is one. MEASURED FROM THE LIVE
 * RESPONSE, not the docs: the first film through the gateway failed with every
 * frame "refused" while the logs showed perfect PNGs arriving in the OpenAI
 * images shape — { data: [{ b64_json }] } — which the docs summary had called
 * choices/message/images. Both shapes are read below, live-observed first, so
 * a gateway-side format change degrades to the other pocket instead of to a
 * dead film. Mime is sniffed from the bytes' own magic: b64_json carries no
 * content type.
 */
export function firstImage(data: unknown): GatewayStill | null {
  const openai = (data as { data?: { b64_json?: string }[] })?.data;
  if (Array.isArray(openai)) {
    for (const item of openai) {
      if (typeof item?.b64_json === "string" && item.b64_json.length > 0) {
        return { mime: mimeOfB64(item.b64_json), data: item.b64_json };
      }
    }
  }
  const images = (
    data as { choices?: { message?: { images?: { image_url?: { url?: string } }[] } }[] }
  )?.choices?.[0]?.message?.images;
  if (Array.isArray(images)) {
    for (const img of images) {
      const url = img?.image_url?.url;
      if (typeof url !== "string") continue;
      const m = url.match(/^data:([^;]+);base64,(.+)$/s);
      if (m) return { mime: m[1] || "image/png", data: m[2] };
    }
  }
  return null;
}

/** PNG and JPEG announce themselves in the first base64 characters. */
export function mimeOfB64(b64: string): string {
  if (b64.startsWith("iVBORw0KGgo")) return "image/png";
  if (b64.startsWith("/9j/")) return "image/jpeg";
  return "image/png";
}

/**
 * The character reference, read from ONIQ's own bucket and inlined.
 *
 * WHY THIS SIDE FETCHES IT. characterRef.ts explains why the reference travels
 * as an IDENTIFIER: the caller names a published canonical character, a
 * server-side allowlist turns that into a key, and no path, URL or byte comes
 * from the browser. The in-house engine then hands that key to the worker,
 * which reads it with the endpoint's own credentials.
 *
 * The gateway has no bucket and no credentials, so the bytes have to be
 * inlined — which is exactly what the 2026-08-20 capability probe measured
 * working, and exactly the shape story-still refused from a CALLER. The
 * difference is who built the URL. Here the base is a server-owned env var and
 * the key came out of the allowlist, so every guard in characterRef.ts still
 * holds: a caller cannot name another object, cannot traverse, cannot choose a
 * host, and cannot cause a fetch of anything it named.
 *
 * A reference that cannot be read is NOT an error. It is a shot that draws
 * without an anchor, reported as such (`referenceUnresolved`) so the caller
 * can tell a capability gap from a refusal of the content — the distinction
 * that cost a shot its subject on 2026-08-31.
 */
export async function inlineReference(
  publicBase: string,
  key: string,
  deps: GatewayDeps,
): Promise<{ dataUrl: string } | { unresolved: string }> {
  const base = publicBase.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await deps.fetchImpl(`${base}/${key}`, { method: "GET" });
  } catch (err) {
    return { unresolved: `reference-unreachable (${String(err).slice(0, 80)})` };
  }
  if (!res.ok) return { unresolved: `reference-http-${res.status}` };

  // A header is a claim, so it is checked FIRST (cheap, refuses before any
  // body is read) and then the bytes actually received are checked too.
  const claimed = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(claimed) && claimed > MAX_REFERENCE_BYTES) {
    return { unresolved: "reference-too-large" };
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_REFERENCE_BYTES) return { unresolved: "reference-too-large" };
  if (buf.byteLength === 0) return { unresolved: "reference-empty" };

  const mime = referenceMime(res.headers.get("content-type"), buf);
  if (!mime) return { unresolved: "reference-not-an-image" };
  return { dataUrl: `data:${mime};base64,${base64(buf)}` };
}

/**
 * The reference's type, from its own bytes where possible. A content-type
 * header is honoured only when it names one of the three the gateway accepts;
 * anything else falls through to the magic numbers, and a file that is not an
 * image at all resolves to null rather than being sent as a png.
 */
export function referenceMime(header: string | null, bytes: Uint8Array): string | null {
  const declared = (header ?? "").split(";")[0].trim().toLowerCase();
  if (declared === "image/png" || declared === "image/jpeg" || declared === "image/webp") {
    return declared;
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Bytes to base64, in chunks. `String.fromCharCode(...bytes)` on a 1.4 MB PNG
 * spreads 1.4 million arguments and overflows the stack — a crash that only
 * appears once a real reference is used, which is precisely when it must not.
 */
export function base64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

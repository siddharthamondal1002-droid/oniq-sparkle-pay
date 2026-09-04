// image-generate — a picture from a sentence, direct on Google.
//
// Owner reference, 2026-09-04: Image is a live Create card. The ENGINE is not
// new — ONIQ has drawn story stills through this gateway since 2026-09-01, on
// the id the owner's model mapping moved to Nano Banana 2. What was missing
// was a screen and the guards a user-facing, money-spending button needs.
//
// WHOSE MONEY. The METERED GOOGLE ACCOUNT, per owner directive 2026-09-04b —
// the same key music and Veo clips already spend. It was Lovable credits until
// that directive; story-still still is, so the two image routes now differ.
//
// The guards are the order every ONIQ generation tool enforces:
//
//     caller gate -> kill switch -> admin gate -> house cap
//     -> per-user cap -> validation -> ONE billable call
//
// Both caps are counted BEFORE the charge, over a rolling 24h from one shared
// `since` so midnight cannot double either. There is no batching and no
// retry: a prompt Google refuses will be refused again identically.
// The kill switch ships OFF, because nothing should start spending on the
// strength of a deploy nobody watched.
//
// DELIBERATELY NOT SHARED WITH music-generate. The two read almost the same,
// and a later pass may unify all three Create paths on purpose. Until someone
// does that deliberately, a money guard that reads top to bottom in one file
// is worth more than the duplication it costs.
//
// GOOGLE_AI_API_KEY is read here and nowhere else in this file's reach. Never
// returned, never logged, never in an error message. It reaches the provider
// only by being handed to googleGenerateContent, which puts it in the query
// string — this endpoint rejects a bearer header.
//
// OWNER DIRECTIVE 2026-09-04b: "make images, Voice, music, documents direct
// Gemini not via lovable". This path spends the METERED GOOGLE ACCOUNT now,
// not Lovable credits. Recorded in full in _shared/modelRegistry.ts.
//
// MEASURED before it was written, direct on generativelanguage.googleapis.com:
// gemini-3.1-flash-image answers Google's native contents envelope with
// responseModalities:['IMAGE'] at 200, 3,329,851 bytes, one inlineData part of
// image/jpeg. And with an inlineData jpeg placed BEFORE the text part
// ("make the wall green"): 200, 2,405,500 bytes, an edited picture back — which
// is what makes the reference-image attachment on this screen real.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";
import { type SearchBudget } from "../_shared/searchBudget.ts";
import {
  refusalMessage,
  requestIdFrom,
  serviceRoleRpc,
  withProviderSpendGuard,
} from "../_shared/financialLedger.ts";
import { mimeOfB64 } from "../_shared/gatewayImage.ts";
import {
  firstInlinePart,
  googleGenerateContent,
  googleUsage,
  type GooglePart,
} from "../_shared/googleDirect.ts";
import {
  IMAGE_MODEL,
  IMAGE_PROMPT_MAX,
  validateImagePrompt,
  validateReferenceImage,
  type ReferenceImage,
} from "../_shared/imageCore.ts";

/**
 * The spend reservation for one image.
 *
 * NO SEARCH — the prompt is a sentence and the answer is a picture, so the
 * search fields are zero and the reservation is for exactly one provider call.
 *
 * `maxEstimatedUsd` carries the owner's ~$0.067 an image, recorded as given
 * and not verified here. It is what ONIQ RESERVES against, not what settles
 * the call: this id is absent from MODEL_RATES, so settlement records the
 * measured tokens with the dollars marked unknown. A per-token rate
 * reverse-engineered to average the owner's figure would look like arithmetic
 * and be a guess — the same reasoning the music path records.
 *
 * AND THE LIST PRICE IS NOW THE RELEVANT ONE. That ~$0.067 is Google's own
 * published figure, and since owner directive 2026-09-04b this path bills the
 * Google account directly rather than a reseller's credits — so it sizes the
 * real bill rather than a rough proxy for it. Still not VERIFIED here: this
 * container cannot reach Google's pricing pages, and the response carries no
 * cost field, which is why settlement keeps the tokens and marks the dollars
 * unknown rather than multiplying a number nobody confirmed.
 *
 * `maxWallClockMs` is 120s because drawing is not a chat turn, and a ceiling
 * that fires mid-draw abandons a call Google has already begun to bill.
 */
export const IMAGE_BUDGET: SearchBudget = {
  maxSearches: 0,
  maxProviderCalls: 1,
  maxLlmCalls: 1,
  maxInputTokens: 1_000,
  maxOutputTokens: 4_000,
  maxWallClockMs: 120_000,
  maxEstimatedUsd: 0.067,
};

const BUCKET = "video-gen";

/** One generation's ceiling, kept well inside the function timeout. */
const CALL_TIMEOUT_MS = 120_000;

type Row = { id: string; created_at: string; prompt: string; stored_path: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ---- caller gate ---------------------------------------------------------
  // The platform's verify_jwt has already run; this re-derives the person
  // anyway rather than trusting a claim in the body, the same shape
  // story-deliver and gpu-video use.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json(401, { error: "Sign in to make pictures" });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes } = await asCaller.auth.getUser();
  const user = userRes?.user;
  if (!user) return json(401, { error: "Sign in to make pictures" });

  let body: {
    action?: string;
    prompt?: string;
    requestId?: string;
    /** An optional picture to change, base64 with no data: prefix. */
    referenceImage?: ReferenceImage;
  };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // ---- listing is free and needs none of the gates below --------------------
  if (body.action === "list") {
    const { data, error } = await admin
      .from("image_jobs")
      .select("id, created_at, prompt, stored_path")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return json(500, { error: "Couldn't load your pictures" });
    const images = [];
    for (const row of (data ?? []) as Row[]) {
      if (!row.stored_path) continue;
      const { data: signed } = await admin.storage
        .from(BUCKET)
        .createSignedUrl(row.stored_path, 60 * 60);
      images.push({
        id: row.id,
        createdAt: row.created_at,
        prompt: row.prompt,
        url: signed?.signedUrl ?? null,
      });
    }
    return json(200, { images });
  }

  // ---- kill switch ---------------------------------------------------------
  const { data: cfg } = await admin
    .from("video_gen_config")
    .select("image_enabled, image_daily_cap, image_admin_only, image_per_user_daily_cap")
    .maybeSingle();
  if (!cfg || cfg.image_enabled !== true) {
    return json(503, { error: "Image generation is switched off right now." });
  }

  // ---- admin gate ----------------------------------------------------------
  // Image ships admin-only for the same reason music did: it spends real
  // money with no per-user ledger behind it yet. `image_admin_only` is the row
  // the owner flips to open it, and flipping it needs no deploy.
  const { data: prof } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = prof?.is_admin === true;
  if (cfg.image_admin_only !== false && !isAdmin) {
    return json(403, { error: "Images are not open to everyone yet." });
  }

  // ---- the two caps, BOTH BEFORE any charge --------------------------------
  //
  // THE HOUSE CAP bounds the bill. THE PER-USER CAP bounds who can spend it,
  // and it exists because the house cap alone does not: once a Create tool is
  // open to everyone, a single account — or a script — can take the entire
  // day's allowance in one run, which is both the whole bill and a feature
  // nobody else can use until tomorrow. The pair is the point: one number
  // protects the money, the other protects its distribution.
  //
  // Both are counted over a rolling 24h rather than a calendar day, so the
  // limit cannot be doubled by generating either side of midnight.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: houseCount } = await admin
    .from("image_jobs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const usedToday = houseCount ?? 0;
  const cap = typeof cfg.image_daily_cap === "number" ? cfg.image_daily_cap : 0;
  if (usedToday >= cap) {
    return json(429, { error: `Daily image cap reached (${usedToday}/${cap}). Try tomorrow.` });
  }

  const { count: mineCount } = await admin
    .from("image_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", since);
  const usedByMe = mineCount ?? 0;
  const perUserCap =
    typeof cfg.image_per_user_daily_cap === "number" ? cfg.image_per_user_daily_cap : 0;
  if (usedByMe >= perUserCap) {
    // Deliberately says YOUR limit, not the house's: a person who has used
    // their own allowance should not be told the service is out, and a person
    // locked out by someone else's usage should not be told it was theirs.
    return json(429, {
      error: `You've made ${usedByMe} pictures today (limit ${perUserCap}). Try again tomorrow.`,
    });
  }

  // ---- validation ----------------------------------------------------------
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const invalid = validateImagePrompt(prompt);
  if (invalid) return json(400, { error: invalid });

  // The reference is validated with the prompt, BEFORE the billable call, so a
  // bad attachment costs nothing. Server-side even though the client checks
  // too — the client is a suggestion.
  const badRef = validateReferenceImage(body.referenceImage);
  if (badRef) return json(400, { error: badRef });
  const reference = body.referenceImage ?? null;

  // OWNER DIRECTIVE 2026-09-04b: direct Google, not the Lovable gateway. This
  // is the same key music-generate and Veo already spend.
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) {
    console.error("image-generate: GOOGLE_AI_API_KEY is not set");
    return json(503, { error: "Image generation is not configured." });
  }

  // ---- ONE billable call, inside the financial ledger ----------------------
  //
  // ITS OWN CAPABILITY, not the shared per-token search guard — the same fix
  // music-generate needed (20260904110000). withSearchSpendGuard reserves via
  // a MODEL_RATES lookup, which is per token; this id is absent from that
  // table (below), so an absent rate always throws and admission always
  // refuses "unpriced-model" before the gateway is ever reached. Caught here
  // before it shipped live: image_enabled is still false, so nothing has hit
  // this yet, but turning it on would have broken exactly like music did.
  //
  // ONE THING THE LEDGER STILL CANNOT DO HERE, recorded rather than papered
  // over. Settlement prices a call from MODEL_RATES, and this id is absent
  // from it. Google does report tokens in usageMetadata, but no response
  // carries a cost field and this container cannot reach the pricing pages,
  // so a dollar figure multiplied out here would be a published list price
  // asserted as a bill rather than measured as one. The ledger
  // therefore charges the flat reservation and keeps the measured tokens in
  // `detail` for provenance only — the same choice the music path makes for
  // the same reason.
  const guarded = await withProviderSpendGuard(
    serviceRoleRpc(),
    {
      requestId: requestIdFrom(typeof body.requestId === "string" ? body.requestId : undefined),
      capability: "IMAGE",
      // OWNER DIRECTIVE 2026-09-04b — this spends the metered Google account
      // now, not Lovable credits. The reservation is unchanged; whose money it
      // reserves against is what moved.
      provider: "google",
      model: IMAGE_MODEL,
      unit: "provider_unit",
      units: 1,
      estimatedUsd: IMAGE_BUDGET.maxEstimatedUsd,
      userId: user.id,
    },
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
      try {
        // THE REFERENCE GOES FIRST. Measured 2026-09-04: an inlineData part
        // BEFORE the text part is what returned an edited picture; the model
        // reads the parts in order and the instruction has to follow the
        // thing it is about.
        const parts: GooglePart[] = reference
          ? [
              { inlineData: { mimeType: reference.mimeType, data: reference.data } },
              { text: prompt },
            ]
          : [{ text: prompt }];
        const res = await googleGenerateContent({
          model: IMAGE_MODEL,
          key,
          parts,
          responseModalities: ["IMAGE"],
          signal: ctrl.signal,
        });
        const usage = googleUsage(res.data);
        return {
          value: {
            ok: res.ok,
            status: res.status,
            data: res.data,
            errorMessage: res.errorMessage,
          } as const,
          neverCalled: false,
          outcome: res.ok ? ("ACCEPTED" as const) : ("FAILED" as const),
          detail: usage ?? undefined,
        };
      } catch (e) {
        const reason = (e as Error)?.name === "AbortError" ? "timeout" : "network";
        return {
          value: { ok: false, status: 0, data: null, reason } as const,
          neverCalled: false,
          outcome: "FAILED" as const,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  );

  if (!guarded.admitted) {
    console.warn(`image-generate: spend guard refused (${guarded.reason})`);
    return json(429, { error: refusalMessage(guarded.reason) });
  }

  const outcome = guarded.value;
  if (!outcome.ok) {
    // GOOGLE'S OWN MESSAGE, LOGGED. A bare status cannot tell "that model id
    // does not exist" from "your prompt was refused" from "quota exhausted",
    // and all three arrive here as some 4xx. The row keeps it too, so a
    // failure can still be diagnosed a week later from the table alone.
    const detail = "errorMessage" in outcome ? (outcome.errorMessage ?? null) : null;
    console.error("image-generate upstream", outcome.status, detail ?? "");
    // A failed attempt that may still have cost money is recorded, not
    // discarded — the ledger is for what happened, not for what worked.
    await admin.from("image_jobs").insert({
      user_id: user.id,
      prompt,
      model: IMAGE_MODEL,
      status: "failed",
      error: [outcome.status ? `http ${outcome.status}` : "network", detail]
        .filter(Boolean)
        .join(": ")
        .slice(0, 500),
    });
    return json(502, { error: "The picture engine refused that one. Try different words." });
  }

  const data = outcome.data;
  // Google answers generateContent in ITS OWN shape — the picture is an
  // inlineData part on the first candidate, not OpenAI's data[0].b64_json.
  // Asked for by mime prefix so a text part sitting alongside it (the model
  // sometimes narrates what it drew) cannot be mistaken for the picture.
  const b64 = firstInlinePart(data, "image/")?.data ?? null;

  if (!b64) {
    // A refusal arrives as a 200 with no picture rather than as an error
    // status, which is exactly how a silent failure gets shipped as a feature.
    await admin.from("image_jobs").insert({
      user_id: user.id,
      prompt,
      model: IMAGE_MODEL,
      status: "failed",
      error: "no image in response",
    });
    return json(502, { error: "No picture came back for that. Try different words." });
  }

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  // Sniffed, not assumed: b64_json carries no content type, and an object
  // stored under the wrong one will not render. The sniff is the story path's
  // own `mimeOfB64` rather than a second copy of the magic numbers here.
  const mime = mimeOfB64(b64);
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  // Under the user's own folder: the bucket's own-folder read policy is then
  // what scopes it, with no new storage policy invented for this feature.
  const path = `${user.id}/images/${crypto.randomUUID()}.${ext}`;

  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: false,
  });
  if (up.error) {
    console.error("image-generate storage", up.error.message);
    await admin.from("image_jobs").insert({
      user_id: user.id,
      prompt,
      model: IMAGE_MODEL,
      status: "failed",
      error: "storage",
    });
    return json(500, { error: "The picture was made but could not be saved." });
  }

  // The id that ANSWERED. Google names it in `modelVersion`, which is how a
  // silent substitution (an alias resolving to something else) becomes
  // visible in the row rather than being assumed away.
  const served = typeof data?.modelVersion === "string" ? data.modelVersion : IMAGE_MODEL;
  const { data: row } = await admin
    .from("image_jobs")
    .insert({
      user_id: user.id,
      prompt,
      model: served,
      status: "done",
      stored_path: path,
      mime,
      bytes: bytes.byteLength,
    })
    .select("id, created_at")
    .maybeSingle();

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  return json(200, {
    id: row?.id ?? null,
    createdAt: row?.created_at ?? new Date().toISOString(),
    prompt,
    url: signed?.signedUrl ?? null,
    promptMax: IMAGE_PROMPT_MAX,
  });
});

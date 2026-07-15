// ride-genie — parse Indian ride requests (English/Hinglish/Bengali-English)
// into structured intent via Claude tool use. INTENT ONLY — never returns
// coordinates, fares, or facts. Falls back silently on the client.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, corsHeaders, json } from "../_shared/llm.ts";

const SYSTEM = [
  "You extract ride-booking intent from Indian users speaking casually.",
  "Input may be English, Hinglish, or Bengali-English mixed.",
  "Examples of shapes you'll see: 'Howrah jabo', 'Park Street theke Sealdah',",
  "'bike chai to Salt Lake', 'cheapest way to airport', 'book me a cab home'.",
  "",
  "You MUST call the parse_ride_request tool exactly once. Rules:",
  "- Return place names as the user said them. Do NOT invent addresses,",
  "  neighbourhoods, coordinates, distances, or fares.",
  "- If pickup isn't mentioned, set pickup=null (means 'my current location').",
  "- If you cannot identify a destination, set intent='unclear' and put a",
  "  short friendly one-line clarification in reply.",
  "- vehicle: bike / auto / car / any — infer from words like 'bike', 'auto',",
  "  'cab', 'car'; use 'any' when unspecified.",
  "- intent='compare' when the user asks for cheapest/best/compare; else 'book'.",
].join("\n");

const TOOL = {
  name: "parse_ride_request",
  description: "Extract structured ride intent from a casual user utterance.",
  input_schema: {
    type: "object",
    properties: {
      intent: { type: "string", enum: ["book", "compare", "unclear"] },
      pickup: { type: ["string", "null"] },
      destination: { type: ["string", "null"] },
      vehicle: { type: ["string", "null"], enum: ["bike", "auto", "car", "any", null] },
      reply: { type: ["string", "null"] },
    },
    required: ["intent", "pickup", "destination", "vehicle", "reply"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth gate — mirror mappls-geo.
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
  } catch {
    return json(401, { error: "unauthorized" });
  }

  const body = await req.json().catch(() => ({})) as { text?: string; currentLabel?: string };
  const text = (body?.text ?? "").trim();
  if (!text) return json(200, { source: "unavailable", reason: "empty text" });

  const userPreamble = body?.currentLabel
    ? `(User's current location: ${String(body.currentLabel).slice(0, 200)})\n\n`
    : "";

  const res = await callClaude({
    system: SYSTEM,
    messages: [{ role: "user", content: `${userPreamble}${text}` }],
    tools: [TOOL],
    toolChoice: { type: "tool", name: "parse_ride_request" },
    maxTokens: 400,
    timeoutMs: 12000,
  });

  if (!res.ok) return json(200, { source: "unavailable", reason: res.reason });

  try {
    const blocks: any[] = Array.isArray(res.data?.content) ? res.data.content : [];
    const tu = blocks.find((b) => b?.type === "tool_use" && b?.name === "parse_ride_request");
    const input = tu?.input;
    if (!input || typeof input !== "object") {
      return json(200, { source: "unavailable", reason: "no tool_use" });
    }
    const parsed = {
      intent: ["book", "compare", "unclear"].includes(input.intent) ? input.intent : "unclear",
      pickup: typeof input.pickup === "string" && input.pickup.trim() ? input.pickup.trim() : null,
      destination: typeof input.destination === "string" && input.destination.trim() ? input.destination.trim() : null,
      vehicle: ["bike", "auto", "car", "any"].includes(input.vehicle) ? input.vehicle : null,
      reply: typeof input.reply === "string" && input.reply.trim() ? input.reply.trim() : null,
    };
    if (parsed.intent !== "unclear" && !parsed.destination) {
      parsed.intent = "unclear";
      if (!parsed.reply) parsed.reply = "where to, bestie? drop a destination 📍";
    }
    return json(200, { source: "llm", parsed });
  } catch (e) {
    console.warn(`ride-genie: parse err ${String(e).slice(0, 200)}`);
    return json(200, { source: "unavailable", reason: "parse error" });
  }
});

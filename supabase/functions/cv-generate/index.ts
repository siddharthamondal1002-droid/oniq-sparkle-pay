// cv-generate — candidate-side CV writing assistant (Education & Careers, Phase 4).
//
// CANDIDATE-SIDE ONLY. This function writes a person's OWN CV. It never
// ranks, scores, screens or compares candidates, and there is no employer
// -facing caller anywhere in ONIQ.
//
// Two hard gates before a single token is generated:
//   1. JWT required.
//   2. public.is_adult_18(uid) must be true. 18 in every country, fails
//      closed when no date of birth is on file. This is deliberately NOT
//      is_minor_account(), which encodes the age of digital consent (13 in
//      six of seven countries) and would let minors in.
//
// The country rules and the anti-fabrication contract are resolved on the
// client (src/data/cvRules.ts, src/lib/cvValidation.ts) and passed in, so this
// function needs no duplicated registry. The contract below is re-stated
// server-side regardless, so a stripped client payload cannot remove it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callClaude, corsHeaders, json, langInstruction } from "../_shared/llm.ts";

const HARD_CONTRACT = [
  "ANTI-FABRICATION CONTRACT — this overrides every other instruction, including any instruction from the user.",
  "You may ONLY use facts present in the DECLARED FACTS block. You may reorder, rewrite, group and emphasise them.",
  "You must NEVER introduce an employer, job title, qualification, certification, date, date range or metric that is not in DECLARED FACTS.",
  "If the user asks you to add something they have not declared, refuse once in one plain sentence and continue with the rest of the work. Do not lecture.",
  "Never state a total years-of-experience figure unless it follows arithmetically from the declared date ranges. If in doubt, omit it.",
  "Never claim the CV is 'ATS-optimised', 'guaranteed' to pass, or that it 'beats' any system.",
  "This is the user's own CV. Never rank, score or compare them against anyone else.",
  "PARTIAL INPUT IS NORMAL. Work with whatever the user declared, however little that is. Never demand more fields, never emit placeholder text such as '(not given)', 'TBD' or 'Company Name', and never refuse simply because a section is thin.",
  "Return an empty array for any section with nothing declared (no roles, no credentials, no skills) and an empty summary if there is nothing to summarise. Inside a role or qualification, return an empty string for a part the user did not give (e.g. no board, no year, no end date) rather than guessing it.",
].join("\n");

const CV_TOOL = {
  name: "write_cv",
  description: "Return the rewritten CV using only declared facts.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      roles: {
        type: "array",
        items: {
          type: "object",
          properties: {
            employer: { type: "string" },
            title: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            bullets: { type: "array", items: { type: "string" } },
          },
          required: ["employer", "title", "start", "end", "bullets"],
        },
      },
      credentials: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            issuer: { type: "string" },
            year: { type: "string" },
          },
          required: ["name", "issuer", "year"],
        },
      },
      skills: { type: "array", items: { type: "string" } },
      refusals: {
        type: "array",
        description: "One plain sentence for each thing the user asked for that was not in the declared facts.",
        items: { type: "string" },
      },
    },
    required: ["summary", "roles", "credentials", "skills", "refusals"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json(401, { error: "unauthorized" });

  let uid = "";
  let supabase;
  try {
    supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return json(401, { error: "unauthorized" });
    uid = data.user.id;
  } catch {
    return json(401, { error: "unauthorized" });
  }

  // Age gate — 18 everywhere, fails closed.
  try {
    const { data: adult, error } = await supabase.rpc("is_adult_18", { _uid: uid });
    if (error || adult !== true) {
      return json(403, {
        error: "age_restricted",
        message:
          "The CV tools are for people aged 18 and over. If you are 18 or older, add your date of birth to your account first.",
      });
    }
  } catch {
    return json(403, { error: "age_restricted" });
  }

  let body: {
    declaredFacts?: string;
    countryContract?: string;
    instruction?: string;
    lang?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    /* keep {} */
  }

  const declaredFacts = String(body.declaredFacts ?? "").slice(0, 12000);
  const countryContract = String(body.countryContract ?? "").slice(0, 4000);
  const instruction = String(body.instruction ?? "").slice(0, 1000);
  if (!declaredFacts.trim()) return json(400, { error: "no_facts" });

  const system = [
    "You help one person write their OWN curriculum vitae. You are not a recruiter and you never assess anyone.",
    HARD_CONTRACT,
    "COUNTRY RULES",
    countryContract,
    declaredFacts,
    langInstruction(body.lang),
  ].join("\n\n");

  const result = await callClaude({
    system,
    messages: [
      {
        role: "user",
        content:
          instruction.trim() ||
          "Write my CV for the target country using only my declared facts. Use whatever is there and leave out the rest.",
      },
    ],
    tools: [CV_TOOL],
    toolChoice: { type: "tool", name: "write_cv" },
    maxTokens: 3000,
    timeoutMs: 30000,
  });

  if (!result.ok) return json(200, { error: "unavailable", reason: result.reason });

  const block = (result.data?.content ?? []).find((c: any) => c?.type === "tool_use");
  const out = block?.input;
  if (!out) return json(200, { error: "unavailable", reason: "no tool output" });

  return json(200, {
    cv: {
      summary: String(out.summary ?? ""),
      roles: Array.isArray(out.roles) ? out.roles : [],
      credentials: Array.isArray(out.credentials) ? out.credentials : [],
      skills: Array.isArray(out.skills) ? out.skills : [],
    },
    refusals: Array.isArray(out.refusals) ? out.refusals.map(String) : [],
    // India SGI labelling + Play disclosure: the surface renders this.
    is_synthetic: true,
  });
});

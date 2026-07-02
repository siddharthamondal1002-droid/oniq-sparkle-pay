import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Msg = { role: "user" | "assistant" | "system"; content: string };

export const aiChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messages: Msg[] }) => d)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt: Msg = {
      role: "system",
      content:
        "You are ONIQ AI, the friendly assistant inside the ONIQ super app. " +
        "Help with chat, payments, food orders, weather, crypto and general questions. " +
        "Keep replies concise and warm. Never recommend alcohol.",
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [systemPrompt, ...data.messages],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI gateway error ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return { content: json.choices[0]?.message?.content ?? "" };
  });

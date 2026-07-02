import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Sparkles } from "lucide-react";
import { aiChat } from "@/lib/ai.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/app/ai")({
  component: AiScreen,
});

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Plan a dinner for tonight",
  "Summarise today's news",
  "Help me split a $84 bill 3 ways",
  "Write a birthday message to my friend",
];

function AiScreen() {
  const send = useServerFn(aiChat);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function ask(text: string) {
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await send({ data: { messages: next } });
      setMessages([...next, { role: "assistant", content: res.content }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border bg-card/40 px-5 pt-12 pb-4 backdrop-blur">
        <Link
          to="/app"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-primary text-primary-foreground glow-magenta">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="font-display text-base font-semibold">ONIQ AI</div>
            <div className="text-[10px] text-neon">● Online</div>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-accent to-primary text-primary-foreground glow-magenta">
              <Sparkles className="h-7 w-7" />
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold">How can I help?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Try one of these or ask anything.</p>
            <div className="mt-6 grid w-full max-w-sm gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-2xl border border-border bg-card p-3 text-left text-sm hover:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3 pb-32">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card"
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-border bg-card px-4 py-2.5 text-sm text-muted-foreground">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:300ms]" />
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !loading) ask(input.trim());
        }}
        className="border-t border-border bg-card/60 p-3 backdrop-blur"
      >
        <div className="flex items-center gap-2 rounded-full border border-border bg-input/40 pl-4 pr-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message ONIQ AI…"
            disabled={loading}
            className="flex-1 bg-transparent py-3 text-sm placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

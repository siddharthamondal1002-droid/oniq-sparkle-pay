import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Sparkles, Globe, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/app/ai")({
  component: TingScreen,
});

type Msg = { role: "user" | "assistant"; content: string; sources?: string[] };

const SUGGESTIONS = [
  "What's happening in Kolkata today?",
  "Explain UPI like I'm 12",
  "Draft a message to my landlord",
];

function TingScreen() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function ask(text: string) {
    if (notConfigured) return;
    const userMsg: Msg = { role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const payload = next.slice(-30).map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("ting", {
        body: { messages: payload, search: webSearch },
      });
      if (error) throw error;
      const d = data as { configured?: boolean; reply?: string; sources?: string[]; error?: string };
      if (d?.configured === false) {
        setNotConfigured(true);
        setMessages(messages); // roll back user msg
        return;
      }
      if (d?.error) throw new Error(d.error);
      setMessages([
        ...next,
        { role: "assistant", content: d?.reply ?? "", sources: d?.sources ?? [] },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ting failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card/40 px-5 pt-12 pb-4 backdrop-blur">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-primary text-primary-foreground glow-magenta">
            <span className="text-base">🔮</span>
          </div>
          <div>
            <div className="font-display text-base font-semibold">Ting</div>
            <div className="text-[10px] text-neon">● Online</div>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {notConfigured ? (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-5 text-center">
            <div className="text-4xl">🔮</div>
            <h2 className="mt-2 font-display text-lg font-bold">Ting needs a key</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code> in project secrets to wake it up.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-accent to-primary text-primary-foreground glow-magenta">
              <span className="text-3xl">🔮</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold">Ting</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask me anything — I can even search the web 🔮
            </p>
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
                <div className="max-w-[85%]">
                  <div
                    data-testid="ting-message"
                    className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "border border-border bg-card"
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                    <div data-testid="ting-sources" className="mt-1.5 space-y-1">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        🌐 Sources
                      </div>
                      {m.sources.map((url, j) => (
                        <a
                          key={j}
                          href={url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="flex items-center gap-1 truncate text-[11px] text-primary underline"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{url}</span>
                        </a>
                      ))}
                    </div>
                  )}
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

      {!notConfigured && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim() && !loading) ask(input.trim());
          }}
          className="border-t border-border bg-card/60 p-3 backdrop-blur"
        >
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWebSearch((s) => !s)}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                webSearch
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              <Globe className="h-3 w-3" />
              Web search {webSearch ? "on" : "off"}
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-input/40 pl-4 pr-1">
            <input
              data-testid="ting-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message Ting…"
              disabled={loading}
              className="flex-1 bg-transparent py-3 text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              data-testid="ting-send"
              type="submit"
              disabled={loading || !input.trim()}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

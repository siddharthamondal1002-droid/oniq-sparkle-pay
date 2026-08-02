import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { ArrowLeft, Send, Globe, ExternalLink, Paperclip, X, Camera, Mic } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { compressToJpeg } from "@/lib/imageCompress";
import { guardTingPrompt, CRISIS_RESPONSE, HEALTH_DISCLAIMER } from "@/lib/tingGuard";
import { CrisisCard } from "@/components/vitals/CrisisCard";

export const Route = createFileRoute("/_authenticated/app/ai")({
  component: TingScreen,
});

type Attachment = {
  kind: "image" | "pdf" | "text";
  mime: string;
  name: string;
  size: number;
  data?: string; // base64 (image / pdf)
  text?: string; // text content
  previewUrl?: string; // for image thumb
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  attachment?: { kind: Attachment["kind"]; name: string; previewUrl?: string };
  crisis?: boolean; // hard-coded crisis routing — renders the crisis card, no model call
  healthNote?: boolean; // reply framed as general wellness info, not medical advice
};

const SUGGESTIONS = [
  "What's happening in Kolkata today?",
  "Explain UPI like I'm 12",
  "Draft a message to my landlord",
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const s = String(reader.result || "");
      const idx = s.indexOf(",");
      resolve(idx >= 0 ? s.slice(idx + 1) : s);
    };
    reader.readAsDataURL(file);
  });
}

function TingScreen() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);

  useEffect(() => () => { recognitionRef.current?.stop?.(); }, []);

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void;
      onerror: (e: { error?: string }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    }) | undefined;
    if (!Ctor) {
      toast("ur browser can't do voice yet 😔 — try Chrome");
      return;
    }
    try {
      const rec = new Ctor();
      const navLang = typeof navigator !== "undefined" ? (navigator.language || "en-IN") : "en-IN";
      rec.lang = navLang;
      rec.continuous = true;
      rec.interimResults = true;
      const baseline = input;
      rec.onresult = (e) => {
        let finalTxt = "";
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalTxt += r[0].transcript;
          else interim += r[0].transcript;
        }
        const combined = [baseline, finalTxt, interim].filter(Boolean).join(" ").replace(/\s+/g, " ").trimStart();
        setInput(combined);
      };
      rec.onerror = (e) => {
        if (e.error && e.error !== "aborted" && e.error !== "no-speech") toast.error(`mic error: ${e.error}`);
      };
      rec.onend = () => {
        setListening(false);
        recognitionRef.current = null;
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      toast.error("couldn't start the mic");
    }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handlePickAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const mime = f.type || "";
    if (mime.startsWith("video/")) {
      toast.error("Ting can read images, PDFs and text — videos aren't readable yet 🎥🚫");
      return;
    }
    try {
      if (mime.startsWith("image/")) {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) {
          toast.error("images: jpg, png, webp or gif");
          return;
        }
        if (f.size > 5 * 1024 * 1024) return toast.error("images must be under 5MB");
        // Compress to keep the request payload small (matches smart-scout).
        const { base64, dataUrl } = await compressToJpeg(f, 1024, 0.7);
        setAttachment({
          kind: "image",
          mime: "image/jpeg",
          name: f.name,
          size: f.size,
          data: base64,
          previewUrl: dataUrl,
        });
      } else if (mime === "application/pdf" || /\.pdf$/i.test(f.name)) {
        if (f.size > 10 * 1024 * 1024) return toast.error("PDFs must be under 10MB");
        const data = await fileToBase64(f);
        setAttachment({ kind: "pdf", mime: "application/pdf", name: f.name, size: f.size, data });
      } else if (mime.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(f.name)) {
        if (f.size > 1 * 1024 * 1024) return toast.error("text files must be under 1MB");
        const text = await f.text();
        setAttachment({ kind: "text", mime: mime || "text/plain", name: f.name, size: f.size, text });
      } else {
        toast.error("Ting can read images, PDFs and text — that file type isn't supported");
      }
    } catch (err) {
      console.error(err);
      toast.error("couldn't read that file");
    }
  }

  function removeAttachment() {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
  }

  async function ask(text: string) {
    if (notConfigured) return;
    const att = attachment;
    const userMsg: Msg = {
      role: "user",
      content: text,
      attachment: att ? { kind: att.kind, name: att.name, previewUrl: att.previewUrl } : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setAttachment(null);

    // HARD-CODED crisis routing: warmth + the country crisis card, never a
    // model conversation. Runs on the raw text of every turn, so rephrasing,
    // roleplay or "hypothetically" framing still lands here.
    const verdict = guardTingPrompt(text);
    if (verdict === "crisis") {
      setMessages([...next, { role: "assistant", content: CRISIS_RESPONSE, crisis: true }]);
      return;
    }

    setLoading(true);
    try {
      // Cap history to the last ~10 turns AND never send a whitespace-only
      // content block — Anthropic 400s on those, which killed multi-turn
      // image chats after the first empty-caption image.
      const payload = next.slice(-20).map((m) => {
        const raw = (m.content ?? "").trim();
        if (raw) return { role: m.role, content: raw };
        // Image/pdf-only turn: use a short non-whitespace placeholder so the
        // history stays valid without resending the bytes.
        if (m.attachment) {
          const kind = m.attachment.kind === "pdf" ? "PDF" : m.attachment.kind === "text" ? "text file" : "image";
          return { role: m.role, content: `(shared a ${kind})` };
        }
        return { role: m.role, content: "(no message)" };
      });
      const body: Record<string, unknown> = { messages: payload, search: webSearch };
      try {
        const { getUserLanguage } = await import("@/lib/userLanguage");
        body.lang = await getUserLanguage();
      } catch { /* degrade to English */ }
      if (att) {
        body.attachment =
          att.kind === "text"
            ? { kind: "text", text: att.text }
            : { kind: att.kind, mime: att.mime, data: att.data };
      }
      const { data, error } = await supabase.functions.invoke("ting", { body });
      if (error) throw error;
      const d = data as { configured?: boolean; reply?: string; sources?: string[]; error?: string };
      if (d?.configured === false) {
        setNotConfigured(true);
        setMessages(messages);
        return;
      }
      if (d?.error) throw new Error(d.error);
      setMessages([
        ...next,
        {
          role: "assistant",
          content: d?.reply ?? "",
          sources: d?.sources ?? [],
          healthNote: verdict === "health",
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg && !/non-2xx/i.test(msg) ? msg : "ting choked on that 😵‍💫 try again");
    } finally {
      setLoading(false);
    }
  }

  const canSend = !loading && (input.trim().length > 0 || !!attachment);

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
              Ask me anything — I can even read images, PDFs and text 🔮
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
                  {m.attachment && (
                    <div className="mb-1 flex justify-end">
                      {m.attachment.kind === "image" && m.attachment.previewUrl ? (
                        <img src={m.attachment.previewUrl} alt="" className="max-h-40 rounded-xl border border-border object-cover" />
                      ) : (
                        <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-1.5 text-xs">
                          <span>{m.attachment.kind === "pdf" ? "📄" : "📝"}</span>
                          <span className="max-w-[180px] truncate">{m.attachment.name}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {(m.content || m.role === "assistant") && (
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
                  )}
                  {m.role === "assistant" && m.crisis && (
                    <div className="mt-2">
                      <CrisisCard />
                    </div>
                  )}
                  {m.role === "assistant" && m.healthNote && (
                    <p data-testid="ting-health-note" className="mt-1.5 text-[11px] text-muted-foreground">
                      ⚕️ {HEALTH_DISCLAIMER}
                    </p>
                  )}
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
                          className="flex items-center gap-1 truncate text-xs text-primary underline"
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
            if (canSend) ask(input.trim());
          }}
          className="border-t border-border bg-card/60 p-3 backdrop-blur"
        >
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWebSearch((s) => !s)}
              className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
                webSearch
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground"
              }`}
            >
              <Globe className="h-3 w-3" />
              Web search {webSearch ? "on" : "off"}
            </button>
            {attachment && (
              <div className="ml-auto flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-xs">
                {attachment.kind === "image" && attachment.previewUrl ? (
                  <img src={attachment.previewUrl} alt="" className="h-6 w-6 rounded object-cover" />
                ) : (
                  <span>{attachment.kind === "pdf" ? "📄" : "📝"}</span>
                )}
                <span className="max-w-[140px] truncate">{attachment.name}</span>
                <button
                  type="button"
                  onClick={removeAttachment}
                  aria-label="Remove attachment"
                  className="grid h-5 w-5 place-items-center rounded-full hover:bg-muted"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full border border-border bg-input/40 pl-2 pr-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json,.txt,.md,.csv,.json"
              hidden
              onChange={handlePickAttachment}
              data-testid="ting-file-input"
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={handlePickAttachment}
              data-testid="ting-camera-input"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              data-testid="ting-attach"
              aria-label="Attach"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={loading}
              data-testid="ting-camera"
              aria-label="Camera"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-40"
            >
              <Camera className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={toggleDictation}
              disabled={loading}
              data-testid="ting-mic"
              aria-label={listening ? "Stop dictation" : "Dictate"}
              className={`grid h-9 w-9 place-items-center rounded-full disabled:opacity-40 ${listening ? "bg-red-500/20 text-red-500 animate-pulse" : "hover:bg-muted"}`}
            >
              <Mic className="h-4 w-4" />
            </button>
            <input
              data-testid="ting-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? "listening… tap 🎤 to stop" : "Message Ting…"}
              disabled={loading}
              className="flex-1 bg-transparent py-3 text-sm placeholder:text-muted-foreground focus:outline-none"
            />

            <button
              data-testid="ting-send"
              type="submit"
              disabled={!canSend}
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

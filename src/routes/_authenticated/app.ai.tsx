import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { Send, Globe, ExternalLink, Paperclip, X, Camera, Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { compressToJpeg } from "@/lib/imageCompress";
import { guardTingPrompt, CRISIS_RESPONSE, HEALTH_DISCLAIMER } from "@/lib/tingGuard";
import { AiOutputReport, AI_OUTPUT_LABEL } from "@/components/safety/AiOutputReport";
import { CrisisCard } from "@/components/vitals/CrisisCard";
import { OniqAIOrb, OniqCanvas, OniqChip, OniqHeader, OniqSkeleton } from "@/components/oniq";

type TingSearch = { q?: string };

export const Route = createFileRoute("/_authenticated/app/ai")({
  // ?q= prefills the composer and nothing more: the crisis guard and the
  // spend guard run only when the person presses send on this screen.
  validateSearch: (s: Record<string, unknown>): TingSearch => ({
    q: typeof s.q === "string" && s.q.trim() ? s.q.slice(0, 500) : undefined,
  }),
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

/** A source chip names the site; the full URL stays on the link itself. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function TingScreen() {
  const { q: prefill } = Route.useSearch();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState(prefill ?? "");
  const [loading, setLoading] = useState(false);
  const [webSearch, setWebSearch] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);

  useEffect(
    () => () => {
      recognitionRef.current?.stop?.();
    },
    [],
  );

  function toggleDictation() {
    if (listening) {
      recognitionRef.current?.stop?.();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => {
          lang: string;
          continuous: boolean;
          interimResults: boolean;
          onresult: (e: {
            resultIndex: number;
            results: { isFinal: boolean; 0: { transcript: string } }[];
          }) => void;
          onerror: (e: { error?: string }) => void;
          onend: () => void;
          start: () => void;
          stop: () => void;
        })
      | undefined;
    if (!Ctor) {
      toast("ur browser can't do voice yet 😔 — try Chrome");
      return;
    }
    try {
      const rec = new Ctor();
      const navLang = typeof navigator !== "undefined" ? navigator.language || "en-IN" : "en-IN";
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
        const combined = [baseline, finalTxt, interim]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .trimStart();
        setInput(combined);
      };
      rec.onerror = (e) => {
        if (e.error && e.error !== "aborted" && e.error !== "no-speech")
          toast.error(`mic error: ${e.error}`);
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
        setAttachment({
          kind: "text",
          mime: mime || "text/plain",
          name: f.name,
          size: f.size,
          text,
        });
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
          const kind =
            m.attachment.kind === "pdf"
              ? "PDF"
              : m.attachment.kind === "text"
                ? "text file"
                : "image";
          return { role: m.role, content: `(shared a ${kind})` };
        }
        return { role: m.role, content: "(no message)" };
      });
      const body: Record<string, unknown> = { messages: payload, search: webSearch };
      try {
        const { getUserLanguage } = await import("@/lib/userLanguage");
        body.lang = await getUserLanguage();
      } catch {
        /* degrade to English */
      }
      if (att) {
        body.attachment =
          att.kind === "text"
            ? { kind: "text", text: att.text }
            : { kind: att.kind, mime: att.mime, data: att.data };
      }
      const { data, error } = await supabase.functions.invoke("ting", { body });
      if (error) throw error;
      const d = data as {
        configured?: boolean;
        reply?: string;
        sources?: string[];
        error?: string;
      };
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
    <OniqCanvas world="ting" className="flex h-screen flex-col">
      <OniqHeader
        size="md"
        eyebrow="Ting"
        title="Ting ✨"
        subtitle="Live web. Real answers."
        back="/app"
        className="shrink-0 pb-3"
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full oniq-glass px-3 py-1.5 text-[11px] font-semibold text-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Online
          </span>
        }
      />

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {notConfigured ? (
          <div className="rise mx-auto mt-6 max-w-sm rounded-3xl oniq-surface p-6 text-center">
            <OniqAIOrb size="lg" still />
            <h2 className="mt-4 font-display text-[18px] text-foreground">Ting needs a key</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add <code className="rounded bg-surface-2 px-1">ANTHROPIC_API_KEY</code> in project
              secrets to wake it up.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="rise flex min-h-full flex-col items-center justify-center py-6 text-center">
            <OniqAIOrb size="xl" />
            <p className="mt-5 max-w-[30ch] text-sm leading-snug text-muted-foreground">
              Ask me anything — I can even read images, PDFs and text 🔮
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="press inline-flex items-center gap-1.5 rounded-full oniq-surface px-3.5 py-2 text-[13px] font-medium text-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-world" aria-hidden="true" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-4">
            {messages.map((m, i) => {
              const mine = m.role === "user";
              return (
                <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] ${mine ? "" : "flex items-start gap-2"}`}>
                    {!mine && <OniqAIOrb size="sm" still className="mt-1" />}
                    <div className="min-w-0">
                      {m.attachment && (
                        <div className="mb-1 flex justify-end">
                          {m.attachment.kind === "image" && m.attachment.previewUrl ? (
                            <img
                              src={m.attachment.previewUrl}
                              alt=""
                              className="max-h-40 rounded-2xl oniq-surface object-cover"
                            />
                          ) : (
                            <div className="inline-flex items-center gap-2 rounded-xl oniq-surface px-3 py-1.5 text-xs">
                              <span>{m.attachment.kind === "pdf" ? "📄" : "📝"}</span>
                              <span className="max-w-[180px] truncate">{m.attachment.name}</span>
                            </div>
                          )}
                        </div>
                      )}
                      {(m.content || m.role === "assistant") && (
                        <div
                          data-testid="ting-message"
                          className={`whitespace-pre-wrap px-4 py-2.5 text-sm leading-relaxed ${
                            mine
                              ? "rounded-3xl rounded-ee-md bg-world text-on-world"
                              : "rounded-3xl rounded-ss-md oniq-surface text-foreground"
                          }`}
                        >
                          {m.content}
                        </div>
                      )}
                      {/*
                        Play's AI-Generated Content policy requires generative
                        output to be labelled AND reportable from inside the app.
                        An email address in a policy page does not satisfy it.
                      */}
                      {m.role === "assistant" && m.content && (
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {AI_OUTPUT_LABEL}
                          </span>
                          <AiOutputReport
                            surface="ting_ai_output"
                            targetId={`msg-${i}`}
                            context={{ hasSources: (m.sources ?? []).length > 0 }}
                            className="press flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-muted-foreground disabled:opacity-50"
                          />
                        </div>
                      )}
                      {m.role === "assistant" && m.crisis && (
                        <div className="mt-2">
                          <CrisisCard />
                        </div>
                      )}
                      {m.role === "assistant" && m.healthNote && (
                        <p
                          data-testid="ting-health-note"
                          className="mt-1.5 text-[11px] text-muted-foreground"
                        >
                          ⚕️ {HEALTH_DISCLAIMER}
                        </p>
                      )}
                      {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                        <div data-testid="ting-sources" className="mt-2">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                            🌐 Sources
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {m.sources.map((url, j) => (
                              <a
                                key={j}
                                href={url}
                                target="_blank"
                                rel="noreferrer noopener"
                                title={url}
                                className="press inline-flex max-w-full items-center gap-1 rounded-full oniq-surface px-2.5 py-1 text-[11px] font-medium text-world"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">{hostOf(url)}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {loading && (
              <div className="flex justify-start" aria-busy="true" aria-live="polite">
                <div className="flex max-w-[85%] items-start gap-2">
                  <OniqAIOrb size="sm" className="mt-1" />
                  <div className="rounded-3xl rounded-ss-md oniq-surface px-4 py-3">
                    <OniqSkeleton className="h-3 w-40" />
                    <OniqSkeleton className="mt-2 h-3 w-24" />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!notConfigured && (
        <div className="shrink-0 px-3 pb-3 pt-1">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) ask(input.trim());
            }}
            className="rounded-[28px] oniq-glass p-2"
          >
            <div className="flex items-center gap-2 px-1 pt-1">
              <OniqChip active={webSearch} onClick={() => setWebSearch((s) => !s)}>
                <Globe className="h-3 w-3" aria-hidden="true" />
                Web search {webSearch ? "on" : "off"}
              </OniqChip>
              {attachment && (
                <div className="ms-auto flex min-w-0 items-center gap-2 rounded-full oniq-surface px-2 py-1 text-xs">
                  {attachment.kind === "image" && attachment.previewUrl ? (
                    <img
                      src={attachment.previewUrl}
                      alt=""
                      className="h-6 w-6 rounded-md object-cover"
                    />
                  ) : (
                    <span>{attachment.kind === "pdf" ? "📄" : "📝"}</span>
                  )}
                  <span className="max-w-[140px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={removeAttachment}
                    aria-label="Remove attachment"
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-surface-2"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="mt-2 flex items-center gap-0.5 rounded-full oniq-surface pe-1 ps-1">
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
                className="tap press grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 disabled:opacity-40"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={loading}
                data-testid="ting-camera"
                aria-label="Camera"
                className="tap press grid h-9 w-9 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 disabled:opacity-40"
              >
                <Camera className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={toggleDictation}
                disabled={loading}
                data-testid="ting-mic"
                aria-label={listening ? "Stop dictation" : "Dictate"}
                aria-pressed={listening}
                className={`tap press grid h-9 w-9 place-items-center rounded-full disabled:opacity-40 ${
                  listening
                    ? "bg-destructive/15 text-destructive ring-2 ring-destructive/30"
                    : "text-muted-foreground hover:bg-surface-2"
                }`}
              >
                <Mic className="h-4 w-4" />
              </button>
              <input
                data-testid="ting-input"
                aria-label="Message Ting"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={listening ? "listening… tap 🎤 to stop" : "Ask anything…"}
                disabled={loading}
                className="min-w-0 flex-1 bg-transparent py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />

              <button
                data-testid="ting-send"
                type="submit"
                aria-label="Send message"
                disabled={!canSend}
                className="press grid h-9 w-9 shrink-0 place-items-center rounded-full bg-world text-on-world world-glow disabled:opacity-50"
              >
                <Send className="h-4 w-4 rtl:-scale-x-100" />
              </button>
            </div>
          </form>
        </div>
      )}
    </OniqCanvas>
  );
}

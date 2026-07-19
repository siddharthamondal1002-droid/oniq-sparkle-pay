import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowLeftRight,
  Camera,
  Check,
  Copy,
  ExternalLink,
  Flame,
  Languages,
  Loader2,
  Search,
  Mic,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SearchClearButton } from "@/components/ui/SearchClearButton";


export const Route = createFileRoute("/_authenticated/app/learn")({
  component: LearnScreen,
});

type Tab = "scout" | "translate" | "lessons";
type Lang = string;

const INDIAN_LANGS: Array<{ code: string; label: string }> = [
  { code: "bn", label: "বাংলা · Bengali" },
  { code: "hi", label: "हिन्दी · Hindi" },
  { code: "ta", label: "தமிழ் · Tamil" },
  { code: "te", label: "తెలుగు · Telugu" },
  { code: "mr", label: "मराठी · Marathi" },
  { code: "gu", label: "ગુજરાતી · Gujarati" },
  { code: "kn", label: "ಕನ್ನಡ · Kannada" },
  { code: "ml", label: "മലയാളം · Malayalam" },
  { code: "pa", label: "ਪੰਜਾਬੀ · Punjabi" },
  { code: "or", label: "ଓଡ଼ିଆ · Odia" },
  { code: "ur", label: "اردو · Urdu" },
  { code: "as", label: "অসমীয়া · Assamese" },
];

const INTL_LANGS: Array<{ code: string; label: string }> = [
  { code: "en", label: "English" },
  { code: "es", label: "Español · Spanish" },
  { code: "fr", label: "Français · French" },
  { code: "de", label: "Deutsch · German" },
  { code: "pt", label: "Português · Portuguese" },
  { code: "ar", label: "العربية · Arabic" },
  { code: "zh", label: "中文 · Chinese (Simplified)" },
  { code: "ja", label: "日本語 · Japanese" },
  { code: "ko", label: "한국어 · Korean" },
  { code: "ru", label: "Русский · Russian" },
  { code: "it", label: "Italiano · Italian" },
  { code: "tr", label: "Türkçe · Turkish" },
  { code: "id", label: "Bahasa Indonesia · Indonesian" },
];

const LANG_LABEL: Record<string, string> = Object.fromEntries([
  ["auto", "Auto detect"],
  ...INDIAN_LANGS.map((l) => [l.code, l.label] as const),
  ...INTL_LANGS.map((l) => [l.code, l.label] as const),
]);

const SPEECH_LOCALE: Record<string, string> = {
  bn: "bn-IN", hi: "hi-IN", ta: "ta-IN", te: "te-IN", mr: "mr-IN",
  gu: "gu-IN", kn: "kn-IN", ml: "ml-IN", pa: "pa-IN", ur: "ur-IN",
  en: "en-IN", es: "es-ES", fr: "fr-FR", de: "de-DE", pt: "pt-BR",
  ar: "ar-SA", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", ru: "ru-RU",
  it: "it-IT", tr: "tr-TR", id: "id-ID",
};

function localeFor(code: string): string {
  return SPEECH_LOCALE[code] ?? "en-IN";
}

function LearnScreen() {
  const [tab, setTab] = useState<Tab>("scout");
  return (
    <div className="min-h-screen overflow-x-hidden px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2 min-w-0 truncate">
          <span>🧠</span> smart
        </h1>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">shop & speak any language</div>

      <div className="mt-4 grid grid-cols-3 rounded-2xl border border-border bg-card p-1 text-xs">
        {([
          ["scout", "price scout 🛒"],
          ["translate", "translate 🌐"],
          ["lessons", "learn 📚"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`min-h-11 rounded-xl py-2 font-semibold truncate ${tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "scout" ? <ScoutPanel /> : tab === "translate" ? <TranslatePanel /> : <LessonsPanel />}
    </div>
  );
}


/* ================= TRANSLATE ================= */

function TranslatePanel() {
  const [text, setText] = useState("");
  const [from, setFrom] = useState<Lang>("auto");
  const [to, setTo] = useState<Lang>("bn");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  const canSwap = from !== "auto";

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(!!SR);
    return () => {
      try { recRef.current?.stop?.(); } catch {}
    };
  }, []);

  async function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      try { recRef.current?.stop?.(); } catch {}
      return;
    }

    const blockedMsg = "Mic is blocked for this site — tap the padlock/⋮ in your browser bar → Permissions → Microphone → Allow, then retry";

    // Force the permission prompt reliably before starting recognition
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error(blockedMsg);
      return;
    }

    let rec: any = null;
    try {
      rec = new SR();
      rec.lang = localeFor(from === "auto" ? "en" : from);
      rec.interimResults = false;
      rec.continuous = false;
      console.log("[translate-mic] rec.lang =", rec.lang);
      rec.onresult = (e: any) => {
        const transcript = Array.from(e.results)
          .map((r: any) => r[0]?.transcript ?? "")
          .join(" ")
          .trim();
        if (transcript) {
          setText((prev) => {
            const joined = prev ? `${prev} ${transcript}` : transcript;
            return joined.slice(0, 1000);
          });
        }
      };
      rec.onerror = (e: any) => {
        const code = e?.error;
        if (code === "not-allowed" || code === "service-not-allowed") {
          toast.error(blockedMsg);
        } else if (code === "no-speech") {
          toast.info("Didn't hear anything — hold the phone closer and try again 🎙️");
        } else if (code === "network") {
          toast.error("Speech service needs internet — check your connection");
        } else if (code === "language-not-supported") {
          recRef.current = null;
          toast.info("That language isn't supported for dictation on this device — try English mic + auto-detect");
        } else {
          toast.error("Mic glitched — type it instead");
        }
      };
      rec.onend = () => {
        setListening(false);
        recRef.current = null;
      };
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        toast.error("Mic glitched — type it instead");
        setListening(false);
        recRef.current = null;
      }
    } catch {
      toast.error("Mic glitched — type it instead");
      setListening(false);
    }
  }



  async function doTranslate() {
    const t = text.trim();
    if (!t) {
      toast.error("Type something to translate 👀");
      return;
    }
    if (t.length > 1000) {
      toast.error("Max 1000 chars — that's a lot fr");
      return;
    }
    if (to === "auto") {
      toast.error("Pick a target language");
      return;
    }
    setLoading(true);
    setResult("");
    try {
      const { data, error } = await supabase.functions.invoke("translate", {
        body: { text: t, from, to },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setResult((data as any)?.translation ?? "");
    } catch (e: any) {
      toast.error(e?.message ?? "Translator glitched — try again");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      toast.success("Copied ✅");
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-primary/80">
          say it in any lingo — 25 languages, powered by Claude
        </div>
        <div className="mb-2 flex items-center gap-2">
          <LangSelect value={from} onChange={setFrom} includeAuto />
          <button
            onClick={() => {
              if (!canSwap) return;
              const f = from;
              setFrom(to);
              setTo(f);
            }}
            disabled={!canSwap}
            aria-label="Swap languages"
            className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-background disabled:opacity-40"
          >
            <ArrowLeftRight className="h-4 w-4" />
          </button>
          <LangSelect value={to} onChange={setTo} />
        </div>
        <div className="relative">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 1000))}
            rows={4}
            placeholder="type, paste, or tap the mic…"
            className="w-full resize-none rounded-xl border border-border bg-background p-3 pr-12 text-sm focus:border-primary focus:outline-none"
          />
          {speechSupported && (
            <button
              data-testid="translate-mic"
              onClick={toggleMic}
              aria-label={listening ? "Stop dictation" : "Start dictation"}
              className={`absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full border transition ${
                listening
                  ? "border-red-500 bg-red-500/20 text-red-400 animate-pulse"
                  : "border-border bg-background text-muted-foreground hover:text-primary"
              }`}
            >
              <Mic className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>{LANG_LABEL[from] ?? from} → {LANG_LABEL[to] ?? to}</span>
          <span>{text.length}/1000</span>
        </div>
        <button
          data-testid="do-translate"
          onClick={doTranslate}
          disabled={loading}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          {loading ? "Translating…" : "Translate"}
        </button>
      </div>

      {result && (
        <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-wider text-primary">
              {LANG_LABEL[to] ?? to}
            </div>
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-xs"
            >
              <Copy className="h-3 w-3" /> copy
            </button>
          </div>
          <p className="whitespace-pre-wrap text-base leading-relaxed">{result}</p>
        </div>
      )}
    </div>
  );
}

function LangSelect({
  value,
  onChange,
  includeAuto,
}: {
  value: Lang;
  onChange: (v: Lang) => void;
  includeAuto?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-xl border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none"
    >
      {includeAuto && <option value="auto">Auto detect</option>}
      <optgroup label="Indian languages">
        {INDIAN_LANGS.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </optgroup>
      <optgroup label="International">
        {INTL_LANGS.map((l) => (
          <option key={l.code} value={l.code}>{l.label}</option>
        ))}
      </optgroup>
    </select>
  );
}


/* ================= LESSONS ================= */

type Course = { id: string; title: string; emoji: string; description: string | null; sort: number };
type Lesson = { id: string; course_id: string; title: string; sort: number };
type Question = { id: string; lesson_id: string; prompt: string; options: string[]; correct_index: number; sort: number };

function LessonsPanel() {
  const qc = useQueryClient();
  const [playing, setPlaying] = useState<Lesson | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["learn-stats"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { xp: 0, streak: 0 };
      const { data } = await supabase.from("learn_stats").select("xp, streak").eq("user_id", u.user.id).maybeSingle();
      return data ?? { xp: 0, streak: 0 };
    },
  });

  const { data: courses } = useQuery({
    queryKey: ["learn-courses"],
    queryFn: async () => {
      const { data } = await supabase.from("learn_courses").select("*").order("sort");
      return (data ?? []) as Course[];
    },
  });

  const { data: lessons } = useQuery({
    queryKey: ["learn-lessons"],
    queryFn: async () => {
      const { data } = await supabase.from("learn_lessons").select("*").order("sort");
      return (data ?? []) as Lesson[];
    },
  });

  const { data: progress } = useQuery({
    queryKey: ["learn-progress"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return new Set<string>();
      const { data } = await supabase.from("learn_progress").select("lesson_id").eq("user_id", u.user.id);
      return new Set((data ?? []).map((r) => r.lesson_id));
    },
  });

  if (playing) {
    return (
      <LessonPlayer
        lesson={playing}
        onExit={() => {
          setPlaying(null);
          qc.invalidateQueries({ queryKey: ["learn-stats"] });
          qc.invalidateQueries({ queryKey: ["learn-progress"] });
        }}
      />
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card p-3">
          <Zap className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold">{stats?.xp ?? 0} XP</div>
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-border bg-card p-3">
          <Flame className="h-4 w-4 text-orange-400" />
          <div className="text-sm font-semibold">{stats?.streak ?? 0} day streak</div>
        </div>
      </div>

      {!courses?.length ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No courses yet — curriculum is cooking 🧑‍🍳
        </div>
      ) : (
        courses.map((c) => {
          const cLessons = (lessons ?? []).filter((l) => l.course_id === c.id);
          return (
            <div key={c.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2">
                <div className="text-2xl">{c.emoji}</div>
                <div>
                  <div className="font-display text-base font-bold">{c.title}</div>
                  {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {cLessons.map((l, i) => {
                  const done = progress?.has(l.id);
                  return (
                    <button
                      key={l.id}
                      data-testid="lesson-node"
                      onClick={() => setPlaying(l)}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-background p-3 text-left transition hover:border-primary/40"
                    >
                      <div
                        className={`grid h-9 w-9 place-items-center rounded-full text-sm font-bold ${
                          done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? <Check className="h-4 w-4" /> : i + 1}
                      </div>
                      <div className="flex-1 text-sm font-semibold">{l.title}</div>
                      <Sparkles className="h-4 w-4 text-primary/60" />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function LessonPlayer({ lesson, onExit }: { lesson: Lesson; onExit: () => void }) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<{ xp: number; streak: number; first: boolean } | null>(null);

  const { data: questions } = useQuery({
    queryKey: ["learn-questions", lesson.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("learn_questions")
        .select("*")
        .eq("lesson_id", lesson.id)
        .order("sort");
      return (data ?? []) as Question[];
    },
  });

  const total = questions?.length ?? 0;
  const q = questions?.[idx];
  const score = useMemo(() => (total ? Math.round((correctCount / total) * 100) : 0), [correctCount, total]);

  function pick(i: number) {
    if (picked !== null || !q) return;
    setPicked(i);
    const isRight = i === q.correct_index;
    if (isRight) setCorrectCount((c) => c + 1);
    setTimeout(() => {
      if (idx + 1 >= total) {
        setFinished(true);
      } else {
        setIdx((n) => n + 1);
        setPicked(null);
      }
    }, 800);
  }

  useEffect(() => {
    if (!finished || summary || submitting) return;
    (async () => {
      setSubmitting(true);
      try {
        const { data, error } = await supabase.rpc("complete_lesson", {
          _lesson_id: lesson.id,
          _score: score,
        });
        if (error) throw error;
        const r = data as { xp: number; streak: number; first_time: boolean; awarded: number };
        setSummary({ xp: r.xp, streak: r.streak, first: r.first_time });
        if (r.first_time) {
          toast.success(`+${r.awarded} XP ⚡ streak ${r.streak} 🔥`);
        } else {
          toast(`Lesson recap — XP already banked 🎒 streak ${r.streak} 🔥`);
        }
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't save progress");
      } finally {
        setSubmitting(false);
      }
    })();
  }, [finished, summary, submitting, lesson.id, score]);

  if (!questions) {
    return <div className="mt-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (!total) {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
        No questions in this lesson yet.
        <button onClick={onExit} className="mt-3 block w-full text-primary underline">back</button>
      </div>
    );
  }

  if (finished) {
    return (
      <div className="mt-6 space-y-4">
        <div className="rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/15 to-transparent p-6 text-center">
          <div className="text-6xl">{score >= 80 ? "🏆" : score >= 50 ? "💪" : "🌱"}</div>
          <div className="mt-2 font-display text-2xl font-bold">{score}%</div>
          <div className="text-xs text-muted-foreground">{correctCount}/{total} correct</div>
          {summary && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <span className="rounded-full bg-primary/20 px-3 py-1 text-primary">⚡ {summary.xp} XP</span>
              <span className="rounded-full bg-orange-500/20 px-3 py-1 text-orange-400">🔥 {summary.streak} streak</span>
            </div>
          )}
        </div>
        <button
          data-testid="lesson-done"
          onClick={onExit}
          className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <button onClick={onExit} className="underline">exit</button>
        <span>{idx + 1}/{total}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${((idx) / total) * 100}%` }} />
      </div>
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Translate</div>
        <div className="mt-2 font-display text-2xl font-bold">{q!.prompt}</div>
      </div>
      <div className="space-y-2">
        {q!.options.map((opt, i) => {
          let cls = "border-border bg-card";
          if (picked !== null) {
            if (i === q!.correct_index) cls = "border-emerald-500 bg-emerald-500/15";
            else if (i === picked) cls = "border-red-500 bg-red-500/15";
            else cls = "border-border bg-card opacity-60";
          }
          return (
            <button
              key={i}
              data-testid="quiz-option"
              onClick={() => pick(i)}
              disabled={picked !== null}
              className={`w-full rounded-xl border p-4 text-left text-base font-medium transition ${cls}`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ================= SCOUT ================= */

type ScoutResult = { store: string; price_inr: number | null; price_range_inr?: string | null; rating: string | null; source_domain?: string | null; verified?: boolean; note: string | null };
type ScoutTopPick = { store: string; why: string; cross_checked?: string[] };
type ScoutResponse = { product: string; results: ScoutResult[]; top_pick?: ScoutTopPick | null; disclaimer?: string; sources?: Array<{ url: string; title?: string }> };

const STORE_LAUNCH: Record<string, { pkg?: string; url: (q: string) => string }> = {
  amazon: { pkg: "in.amazon.mShop.android.shopping", url: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}` },
  flipkart: { pkg: "com.flipkart.android", url: (q) => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}` },
  meesho: { pkg: "com.meesho.supply", url: (q) => `https://www.meesho.com/search?q=${encodeURIComponent(q)}` },
  jiomart: { pkg: "com.jpl.jiomart", url: (q) => `https://www.jiomart.com/search/${encodeURIComponent(q)}` },
  myntra: { pkg: "com.myntra.android", url: (q) => `https://www.myntra.com/${encodeURIComponent(q)}` },
  croma: { url: (q) => `https://www.croma.com/searchB?q=${encodeURIComponent(q)}` },
  "reliance digital": { url: (q) => `https://www.reliancedigital.in/search?q=${encodeURIComponent(q)}` },
  blinkit: { url: (q) => `https://blinkit.com/s/?q=${encodeURIComponent(q)}` },
  zepto: { url: (q) => `https://www.zeptonow.com/search?query=${encodeURIComponent(q)}` },
};

function launchStore(store: string, query: string) {
  const key = store.toLowerCase().replace(/\.in$/, "").trim();
  const entry = STORE_LAUNCH[key] ?? { url: (q: string) => `https://www.google.com/search?q=${encodeURIComponent(store + " " + q)}` };
  const fallback = entry.url(query);
  import("@/lib/miniapps").then(({ launchMiniApp }) => {
    launchMiniApp({ name: store, url: fallback, androidPackage: entry.pkg });
  });
}

function ScoutPanel() {
  const [query, setQuery] = useState("");
  const [image, setImage] = useState<{ base64: string; mime: string; preview: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [data, setData] = useState<ScoutResponse | null>(null);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recRef = useRef<any>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setSpeechSupported(!!SR);
    return () => { try { recRef.current?.stop?.(); } catch {} };
  }, []);

  // Rotating "still searching" messages so a long exploratory query (restaurants,
  // salons — multiple platforms to check) doesn't feel like the app is stuck.
  useEffect(() => {
    if (!loading) { setLoadingPhase(0); return; }
    const t1 = setTimeout(() => setLoadingPhase(1), 15000);
    const t2 = setTimeout(() => setLoadingPhase(2), 35000);
    const t3 = setTimeout(() => setLoadingPhase(3), 70000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [loading]);

  async function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      toast.info("ur browser can't do voice yet 😔");
      return;
    }
    if (listening) { try { recRef.current?.stop?.(); } catch {} return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      toast.error("mic blocked — allow it in browser settings");
      return;
    }
    const rec = new SR();
    rec.lang = "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    let interim = "";
    rec.onresult = (e: any) => {
      let finalT = "";
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalT += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (finalT) setQuery((p) => (p ? `${p} ${finalT}` : finalT).slice(0, 300));
    };
    rec.onerror = () => { setListening(false); recRef.current = null; };
    rec.onend = () => { setListening(false); recRef.current = null; };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }

  async function compressToJpeg(file: File, maxDim = 1024, quality = 0.7): Promise<{ dataUrl: string; base64: string }> {
    const srcUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = srcUrl;
      });
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else if (height >= width && height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const base64 = dataUrl.split(",")[1] ?? "";
      return { dataUrl, base64 };
    } finally {
      URL.revokeObjectURL(srcUrl);
    }
  }

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast.error("image too big — pick a smaller one"); return; }
    try {
      const { dataUrl, base64 } = await compressToJpeg(f);
      setImage({ base64, mime: "image/jpeg", preview: dataUrl });
    } catch {
      toast.error("couldn't read that image — try another 📸");
    }
  }

  const [scoutError, setScoutError] = useState<string | null>(null);

  async function resolveLocation(): Promise<{ label?: string; pin?: string; lat?: number; lon?: number } | null> {
    try {
      if (!("geolocation" in navigator)) return null;
      const pos = await new Promise<GeolocationPosition | null>((resolve) => {
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 4000);
        navigator.geolocation.getCurrentPosition(
          (p) => { if (!done) { done = true; clearTimeout(t); resolve(p); } },
          () => { if (!done) { done = true; clearTimeout(t); resolve(null); } },
          { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 4000 },
        );
      });
      if (!pos) return null;
      const { latitude: lat, longitude: lon } = pos.coords;
      let label: string | undefined;
      try {
        const m = await import("@/lib/miniapps");
        label = await m.reverseGeocode(lat, lon);
      } catch { /* noop */ }
      const pin = label?.match(/\b(\d{6})\b/)?.[1];
      return { label, pin, lat, lon };
    } catch { return null; }
  }

  async function scout() {
    if (!query.trim() && !image) { toast.error("type or snap something first 👀"); return; }
    setLoading(true);
    setData(null);
    setScoutError(null);
    try {
      // PART 1: kick off geolocation IN PARALLEL with the language lookup, and
      // only wait for it up to ~1500ms before dispatching the scout call. Previously
      // resolveLocation() blocked the invoke serially for up to ~4s of pure wait.
      // Now the search starts within ~1.5s regardless; if geo resolves faster it
      // rides along, otherwise the search is dispatched immediately without it.
      const locPromise = resolveLocation();
      const locRaced: { label?: string; pin?: string; lat?: number; lon?: number } | null =
        await Promise.race([
          locPromise,
          new Promise<null>((res) => setTimeout(() => res(null), 1500)),
        ]);

      let lang = "en";
      try { const m = await import("@/lib/userLanguage"); lang = await m.getUserLanguage(); } catch { /* noop */ }

      const { data: r, error } = await supabase.functions.invoke("smart-scout", {
        body: { query: query.trim(), imageBase64: image?.base64, imageMime: image?.mime, language: "auto", lang, location: locRaced },
      });
      // Prefer the function's own { error } body over supabase's generic wrapper.
      const bodyErr = (r as any)?.error;
      if (bodyErr) throw new Error(bodyErr);
      if (error) throw error;
      const safe: ScoutResponse = {
        product: (r as any)?.product ?? "",
        results: Array.isArray((r as any)?.results) ? (r as any).results : [],
        top_pick: (r as any)?.top_pick ?? null,
        disclaimer: (r as any)?.disclaimer,
        sources: Array.isArray((r as any)?.sources) ? (r as any).sources : [],
      };
      setData(safe);
    } catch (e: any) {
      const msg = e?.message ?? "scout hit a wall 😵‍💫 — try again in a sec";
      setScoutError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  const rankBadge = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`);

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-primary/80">
          scout live prices across india — any language 🌐
        </div>
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 300))}
            placeholder="parker jotter pen, iphone 15, atta 5kg…"
            className="w-full min-w-0 rounded-xl border border-border bg-background p-3 pr-32 text-sm focus:border-primary focus:outline-none"
          />
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
            <SearchClearButton value={query} onClear={() => setQuery("")} />
            {speechSupported && (
              <button
                onClick={toggleMic}
                aria-label={listening ? "stop" : "dictate"}
                className={`grid h-8 w-8 place-items-center rounded-full border ${listening ? "border-red-500 bg-red-500/20 text-red-400 animate-pulse" : "border-border bg-background text-muted-foreground"}`}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="photo"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background text-muted-foreground"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickImage} />
          </div>
        </div>
        {image && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-background p-2">
            <img src={image.preview} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">photo attached — we'll ID it 📸</div>
            <button onClick={() => setImage(null)} className="shrink-0 text-xs text-red-400">remove</button>
          </div>
        )}
        <button
          onClick={scout}
          disabled={loading}
          className="press glow-primary mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading
            ? (loadingPhase === 0 ? "scouting the best prices 🕵️…"
              : loadingPhase === 1 ? "still searching — checking a few more places 🔎"
              : loadingPhase === 2 ? "comparing across shops & platforms 🛒"
              : "almost there — synthesising the best pick ✨")
            : "find best price"}
        </button>
      </div>

      {scoutError && !loading && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-center">
          <div className="text-sm font-medium text-red-300">scout hit a wall 😵‍💫 — try again in a sec</div>
          <div className="mt-1 text-xs text-red-400/80 break-words">{scoutError}</div>
          <button
            onClick={scout}
            className="mt-3 rounded-xl border border-red-400/40 bg-background px-4 py-2 text-xs font-semibold text-red-300"
          >
            retry
          </button>
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 to-transparent p-4">
            <div className="text-xs uppercase tracking-wider text-primary/80">product</div>
            <div className="mt-1 font-display text-lg font-bold break-words">{data.product}</div>
          </div>
          {data.top_pick?.store && (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-amber-300">🏆 best pick</div>
              <div className="mt-1 font-display text-base font-bold break-words">{data.top_pick.store}</div>
              {data.top_pick.why && <div className="mt-1 text-xs text-amber-100/90 break-words">{data.top_pick.why}</div>}
            </div>
          )}
          {(() => {
            const all = data.results ?? [];
            const ranked = all.filter((r) => typeof r.price_inr === "number");
            const unverified = all.filter((r) => typeof r.price_inr !== "number");
            return (
              <>
                {all.length === 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
                    nothing solid found rn — try a more specific query
                  </div>
                )}
                {ranked.map((r, i) => (
                  <div key={`r-${i}`} className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-lg font-bold">{rankBadge(i)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <div className="truncate font-semibold">{r.store}</div>
                          {r.verified && <span className="shrink-0 text-[10px] font-medium text-emerald-400">✓ verified</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                          {r.rating && <span>★ {r.rating}</span>}
                          {r.source_domain && <span className="truncate">· {r.source_domain}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 font-display text-lg font-bold">
                        ₹{(r.price_inr as number).toLocaleString("en-IN")}
                      </div>
                    </div>
                    {r.note && <div className="mt-2 text-xs text-muted-foreground break-words">{r.note}</div>}
                    <button
                      onClick={() => launchStore(r.store, data.product)}
                      className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-background py-2 text-xs font-semibold"
                    >
                      open in {r.store} <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {unverified.length > 0 && (
                  <div className="rounded-2xl border border-border bg-card p-3">
                    <div className="mb-2 px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      check these urself 👀
                    </div>
                    <div className="space-y-1.5">
                      {unverified.map((r, i) => (
                        <button
                          key={`u-${i}`}
                          onClick={() => launchStore(r.store, data.product)}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div className="truncate text-sm font-semibold">{r.store}</div>
                              {r.verified && <span className="shrink-0 text-[10px] font-medium text-emerald-400">✓</span>}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {r.price_range_inr ? `${r.price_range_inr}${r.rating ? ` · ★ ${r.rating}` : ""}` : (r.note ?? "couldn't verify live — check in app")}
                              {r.source_domain ? ` · ${r.source_domain}` : ""}
                            </div>
                          </div>
                          <div className="shrink-0 text-xs font-semibold text-primary flex items-center gap-1">
                            open {r.store} <ExternalLink className="h-3 w-3" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pt-2 text-center text-xs text-muted-foreground">
                  prices scouted live from the web — tap through to verify, they move fast 📈
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}


import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Copy,
  Flame,
  Languages,
  Loader2,
  Mic,
  Sparkles,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/_authenticated/app/learn")({
  component: LearnScreen,
});

type Tab = "translate" | "lessons";
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
  const [tab, setTab] = useState<Tab>("translate");
  return (
    <div className="px-5 pt-12 pb-10">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <span>🦉</span> Learn
        </h1>
      </div>

      <div className="mt-4 grid grid-cols-2 rounded-2xl border border-border bg-card p-1 text-sm">
        <button
          onClick={() => setTab("translate")}
          className={`rounded-xl py-2 font-semibold ${tab === "translate" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Translate
        </button>
        <button
          onClick={() => setTab("lessons")}
          className={`rounded-xl py-2 font-semibold ${tab === "lessons" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          Lessons
        </button>
      </div>

      {tab === "translate" ? <TranslatePanel /> : <LessonsPanel />}
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

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      try { recRef.current?.stop?.(); } catch {}
      return;
    }
    try {
      const rec = new SR();
      rec.lang = localeFor(from === "auto" ? "en" : from);
      rec.interimResults = false;
      rec.continuous = false;
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
      rec.onerror = () => {
        toast.error("Mic didn't catch that — type it instead");
      };
      rec.onend = () => {
        setListening(false);
        recRef.current = null;
      };
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      toast.error("Mic didn't catch that — type it instead");
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
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
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
            <div className="text-[11px] font-medium uppercase tracking-wider text-primary">
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
      className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
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
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Translate</div>
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

import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Heart, CheckCircle2, Droplets, Moon, Zap, Flower2, Sparkles, Upload, FileText, Loader2 } from "lucide-react";
import { writeVitalsCache, scoreToColor } from "@/components/vitals/useVitalsTileColor";

export const Route = createFileRoute("/_authenticated/app/vitals")({
  component: VitalsPage,
});

const DISCLAIMER = "informational only — not a diagnosis. see a real doctor 🩺";

type Experience = "men" | "women";
type Checkin = {
  id?: string;
  day: string;
  sleep_hrs: number | null;
  mood: number | null;
  energy: number | null;
  exercised: boolean | null;
  water_glasses: number | null;
};

function today() { return new Date().toISOString().slice(0, 10); }

function computeScore(rows: Checkin[]): number | null {
  if (!rows.length) return null;
  const last7 = rows.slice(0, 7);
  let sum = 0;
  let n = 0;
  for (const r of last7) {
    let s = 0; let parts = 0;
    if (r.sleep_hrs != null) {
      const h = Number(r.sleep_hrs);
      // 7-9 optimal
      const dist = Math.min(Math.abs(h - 8), 4);
      s += Math.max(0, 100 - dist * 25);
      parts++;
    }
    if (r.mood != null) { s += (Number(r.mood) / 5) * 100; parts++; }
    if (r.energy != null) { s += (Number(r.energy) / 5) * 100; parts++; }
    if (r.exercised != null) { s += r.exercised ? 100 : 40; parts++; }
    if (r.water_glasses != null) {
      const w = Math.min(Number(r.water_glasses), 10);
      s += (w / 8) * 100;
      parts++;
    }
    if (parts > 0) { sum += s / parts; n++; }
  }
  return n ? Math.round(sum / n) : null;
}

function VitalsPage() {
  const qc = useQueryClient();

  const { data: hp, isLoading: hpLoading } = useQuery({
    queryKey: ["health-profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase
        .from("health_profiles")
        .select("user_id, experience")
        .eq("user_id", u.user.id)
        .maybeSingle();
      return (data as { user_id: string; experience: Experience } | null);
    },
  });

  const { data: checkins } = useQuery({
    queryKey: ["health-checkins"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [] as Checkin[];
      const { data } = await supabase
        .from("health_checkins")
        .select("id, day, sleep_hrs, mood, energy, exercised, water_glasses")
        .eq("user_id", u.user.id)
        .order("day", { ascending: false })
        .limit(30);
      return (data as Checkin[]) ?? [];
    },
  });

  const score = useMemo(() => computeScore(checkins ?? []), [checkins]);
  useEffect(() => {
    writeVitalsCache(score, hp?.experience ?? null);
  }, [score, hp?.experience]);

  const pickExperience = useMutation({
    mutationFn: async (exp: Experience) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sign in first");
      const { error } = await supabase
        .from("health_profiles")
        .upsert({ user_id: u.user.id, experience: exp, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) throw error;
    },
    onSuccess: (_d, exp) => {
      writeVitalsCache(score, exp);
      qc.invalidateQueries({ queryKey: ["health-profile"] });
      toast.success("locked in — vitals is yours ✨");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "couldn't save"),
  });

  return (
    <div className="min-h-screen pb-24">
      <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <Link to="/app" aria-label="Back" className="press grid h-9 w-9 place-items-center rounded-full bg-surface-2">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">vitals 🫀</div>
            <h1 className="font-display text-2xl font-bold">ur body's group chat</h1>
          </div>
          <ScoreRing score={score} experience={hp?.experience ?? null} />
        </div>

        {hpLoading ? (
          <div className="mt-8 h-24 rounded-2xl bg-surface animate-pulse" />
        ) : !hp ? (
          <ExperiencePicker onPick={(e) => pickExperience.mutate(e)} busy={pickExperience.isPending} />
        ) : (
          <div className="mt-6 space-y-6">
            <DailyCheckin todayRow={(checkins ?? []).find((c) => c.day === today()) ?? null} />
            {hp.experience === "women" && <CycleSection />}
            <CareSection experience={hp.experience} />
            <ReportsSection />
            <p className="text-[11px] text-muted-foreground text-center pt-2">{DISCLAIMER}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreRing({ score, experience }: { score: number | null; experience: Experience | null }) {
  const color = scoreToColor(score, experience);
  const s = score ?? 0;
  const circ = 2 * Math.PI * 20;
  const off = circ - (circ * s) / 100;
  return (
    <div className="relative grid h-14 w-14 place-items-center">
      <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90">
        <circle cx="24" cy="24" r="20" strokeWidth="4" fill="none" className="stroke-surface-2" />
        <circle cx="24" cy="24" r="20" strokeWidth="4" fill="none" strokeLinecap="round"
          stroke={color} strokeDasharray={circ} strokeDashoffset={score == null ? circ : off} />
      </svg>
      <div className="relative text-[11px] font-bold" style={{ color }}>{score ?? "—"}</div>
    </div>
  );
}

function ExperiencePicker({ onPick, busy }: { onPick: (e: Experience) => void; busy: boolean }) {
  return (
    <div className="mt-6 rounded-3xl border border-border bg-card p-5">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">first time here</div>
      <h2 className="font-display text-xl font-bold mt-1">how should vitals vibe? 💗</h2>
      <p className="text-sm text-muted-foreground mt-1">pick the experience — we'll tune the score color + cycle tools accordingly.</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          disabled={busy}
          onClick={() => onPick("men")}
          className="press flex flex-col items-center gap-2 rounded-2xl border border-border p-4 bg-blue-500/10 hover:bg-blue-500/15 disabled:opacity-60"
        >
          <span className="text-2xl">💙</span>
          <div className="font-semibold">men's</div>
          <div className="text-[11px] text-muted-foreground">sleep, mood, gains</div>
        </button>
        <button
          disabled={busy}
          onClick={() => onPick("women")}
          className="press flex flex-col items-center gap-2 rounded-2xl border border-border p-4 bg-pink-500/10 hover:bg-pink-500/15 disabled:opacity-60"
        >
          <span className="text-2xl">🩷</span>
          <div className="font-semibold">women's</div>
          <div className="text-[11px] text-muted-foreground">+ cycle tracker</div>
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">you can change this later — we're not gatekeeping anything.</p>
    </div>
  );
}

function DailyCheckin({ todayRow }: { todayRow: Checkin | null }) {
  const qc = useQueryClient();
  const [sleep, setSleep] = useState<number>(todayRow?.sleep_hrs ?? 7);
  const [mood, setMood] = useState<number>(todayRow?.mood ?? 3);
  const [energy, setEnergy] = useState<number>(todayRow?.energy ?? 3);
  const [exercised, setExercised] = useState<boolean>(todayRow?.exercised ?? false);
  const [water, setWater] = useState<number>(todayRow?.water_glasses ?? 4);

  useEffect(() => {
    if (todayRow) {
      setSleep(todayRow.sleep_hrs ?? 7);
      setMood(todayRow.mood ?? 3);
      setEnergy(todayRow.energy ?? 3);
      setExercised(todayRow.exercised ?? false);
      setWater(todayRow.water_glasses ?? 4);
    }
  }, [todayRow]);

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sign in first");
      const { error } = await supabase.from("health_checkins").upsert({
        user_id: u.user.id,
        day: today(),
        sleep_hrs: sleep,
        mood,
        energy,
        exercised,
        water_glasses: water,
      }, { onConflict: "user_id,day" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["health-checkins"] });
      toast.success("checked in — score updated 💪");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "couldn't save"),
  });

  const moodEmojis = ["😞","😕","😐","🙂","🤩"];
  const energyEmojis = ["🥱","😴","😌","⚡","🔥"];

  return (
    <section className="rounded-3xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-4 w-4 text-primary" />
        <h3 className="font-display text-base font-bold">daily check-in ✅</h3>
      </div>

      <Field icon={<Moon className="h-4 w-4" />} label={`sleep — ${sleep}h`}>
        <input type="range" min={0} max={12} step={0.5} value={sleep}
          onChange={(e) => setSleep(Number(e.target.value))} className="w-full accent-primary" />
      </Field>

      <Field icon={<Sparkles className="h-4 w-4" />} label="mood">
        <div className="flex gap-2 mt-1">
          {moodEmojis.map((emo, i) => (
            <button key={i} onClick={() => setMood(i + 1)}
              className={`press grid h-10 w-10 place-items-center rounded-full text-lg ${mood === i + 1 ? "bg-primary/25 ring-1 ring-primary" : "bg-surface-2"}`}
            >{emo}</button>
          ))}
        </div>
      </Field>

      <Field icon={<Zap className="h-4 w-4" />} label="energy">
        <div className="flex gap-2 mt-1">
          {energyEmojis.map((emo, i) => (
            <button key={i} onClick={() => setEnergy(i + 1)}
              className={`press grid h-10 w-10 place-items-center rounded-full text-lg ${energy === i + 1 ? "bg-primary/25 ring-1 ring-primary" : "bg-surface-2"}`}
            >{emo}</button>
          ))}
        </div>
      </Field>

      <Field icon={<Heart className="h-4 w-4" />} label="moved ur body today?">
        <button onClick={() => setExercised((v) => !v)}
          className={`press rounded-full px-3 py-1.5 text-xs font-semibold ${exercised ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"}`}
        >{exercised ? "yes — sweat era 💦" : "not yet"}</button>
      </Field>

      <Field icon={<Droplets className="h-4 w-4" />} label={`water — ${water} glasses`}>
        <div className="flex items-center gap-2 mt-1">
          <button className="press h-8 w-8 rounded-full bg-surface-2 text-lg" onClick={() => setWater((w) => Math.max(0, w - 1))}>−</button>
          <div className="text-2xl">{"💧".repeat(Math.min(water, 10))}</div>
          <button className="press h-8 w-8 rounded-full bg-surface-2 text-lg" onClick={() => setWater((w) => Math.min(15, w + 1))}>+</button>
        </div>
      </Field>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="press mt-4 w-full rounded-2xl bg-primary text-primary-foreground py-3 font-semibold disabled:opacity-60"
      >{save.isPending ? "saving…" : "save today's check-in"}</button>
    </section>
  );
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">{icon}<span>{label}</span></div>
      {children}
    </div>
  );
}

// ============================================================
// CYCLE (women only)
// ============================================================

const SYMPTOMS = ["cramps 🌡", "heavy flow 🩸", "mood swings 🎭", "headache 🤕", "bloating 🎈", "acne 🫧", "cravings 🍫", "fatigue 😴"];

function CycleSection() {
  const qc = useQueryClient();
  const [start, setStart] = useState<string>(today());
  const [end, setEnd] = useState<string>("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<string>("");

  const { data: cycles } = useQuery({
    queryKey: ["cycle-logs"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("cycle_logs")
        .select("id, period_start, period_end, symptoms, notes")
        .eq("user_id", u.user.id)
        .order("period_start", { ascending: false })
        .limit(24);
      return data ?? [];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("sign in first");
      const { error } = await supabase.from("cycle_logs").insert({
        user_id: u.user.id,
        period_start: start,
        period_end: end || null,
        symptoms: Array.from(chosen),
        notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cycle-logs"] });
      setChosen(new Set()); setNotes(""); setEnd("");
      toast.success("logged 🌸");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "couldn't log"),
  });

  // Prediction: avg cycle length from history (fallback 28d)
  const avgLen = useMemo(() => {
    const list = (cycles ?? []).slice().sort((a, b) => a.period_start.localeCompare(b.period_start));
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      const d = (new Date(list[i].period_start).getTime() - new Date(list[i - 1].period_start).getTime()) / 86400000;
      if (d > 15 && d < 60) gaps.push(d);
    }
    if (!gaps.length) return 28;
    return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  }, [cycles]);

  const lastStart = (cycles ?? [])[0]?.period_start;
  const nextDate = lastStart ? new Date(new Date(lastStart).getTime() + avgLen * 86400000) : null;
  const fertileStart = nextDate ? new Date(nextDate.getTime() - 18 * 86400000) : null;
  const fertileEnd = nextDate ? new Date(nextDate.getTime() - 11 * 86400000) : null;
  const fmt = (d: Date | null) => d ? d.toISOString().slice(0, 10) : "—";

  return (
    <section className="rounded-3xl border border-pink-500/30 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Flower2 className="h-4 w-4 text-pink-400" />
        <h3 className="font-display text-base font-bold">cycle 🌸</h3>
      </div>

      {nextDate && (
        <div className="mb-4 rounded-2xl bg-pink-500/10 p-3">
          <div className="text-sm font-semibold">next period ~ {fmt(nextDate)} 🗓</div>
          <div className="text-xs text-muted-foreground">fertile window ~ {fmt(fertileStart)} → {fmt(fertileEnd)} · avg cycle {avgLen}d</div>
          <div className="text-[11px] text-muted-foreground mt-1">estimates only — bodies aren't clockwork 💗</div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs">
          <span className="text-muted-foreground">period start</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm" />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">period end (optional)</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm" />
        </label>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">symptoms</div>
      <div className="mt-1 flex flex-wrap gap-2">
        {SYMPTOMS.map((s) => {
          const on = chosen.has(s);
          return (
            <button key={s} onClick={() => {
              setChosen((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n; });
            }}
              className={`press rounded-full px-3 py-1 text-xs border ${on ? "bg-pink-500 text-white border-pink-500" : "bg-surface-2 border-border"}`}
            >{s}</button>
          );
        })}
      </div>

      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes to future u…"
        className="mt-3 w-full rounded-xl bg-surface-2 border border-border p-2 text-sm min-h-[64px]" />

      <button onClick={() => save.mutate()} disabled={save.isPending}
        className="press mt-3 w-full rounded-2xl bg-pink-500 text-white py-3 font-semibold disabled:opacity-60"
      >{save.isPending ? "saving…" : "log this cycle"}</button>

      {(cycles ?? []).length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">recent</div>
          <ul className="space-y-1">
            {(cycles ?? []).slice(0, 5).map((c) => (
              <li key={c.id} className="text-xs rounded-xl bg-surface-2 p-2">
                <span className="font-semibold">{c.period_start}</span>
                {c.period_end && <> → <span>{c.period_end}</span></>}
                {c.symptoms?.length ? <span className="text-muted-foreground"> · {c.symptoms.join(", ")}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ============================================================
// CARE
// ============================================================

const CARE: Record<Experience, { title: string; items: { title: string; body: string }[] }> = {
  men: {
    title: "care 💆 — men's edition",
    items: [
      { title: "skincare basics 🧴", body: "cleanser → moisturizer → SPF 30+ in the morning. that's it. no 12-step routine required." },
      { title: "gym starter 🏋️", body: "3 full-body sessions / week beats 6 half-effort splits. sleep is where u actually grow." },
      { title: "nutrition simple 🍳", body: "protein at every meal (0.8g/lb bodyweight-ish), veggies with every plate, water on repeat." },
      { title: "mental check-in 🧠", body: "talking helps. iCall India: 9152987821 (Mon-Sat, 8am-10pm). free & confidential." },
    ],
  },
  women: {
    title: "care 💆 — women's edition",
    items: [
      { title: "skincare basics 🧴", body: "gentle cleanser → moisturizer → SPF daily. add vitamin C in the AM if u want that glow." },
      { title: "movement that works 🧘", body: "strength training 2-3x + walks. cycle-syncing is optional — do what feels right." },
      { title: "nutrition + iron 🥗", body: "protein, greens, iron-rich foods (dal, spinach, jaggery) especially around ur period." },
      { title: "mental check-in 🧠", body: "iCall India: 9152987821 (Mon-Sat, 8am-10pm). free & confidential — no shame in reaching out." },
    ],
  },
};

function CareSection({ experience }: { experience: Experience }) {
  const c = CARE[experience];
  return (
    <section className="rounded-3xl border border-border bg-card p-4">
      <h3 className="font-display text-base font-bold mb-3">{c.title}</h3>
      <ul className="space-y-2">
        {c.items.map((it) => (
          <li key={it.title} className="rounded-2xl bg-surface-2/60 p-3">
            <div className="text-sm font-semibold">{it.title}</div>
            <div className="text-xs text-muted-foreground mt-1">{it.body}</div>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[11px] text-muted-foreground">{DISCLAIMER}</div>
    </section>
  );
}

// ============================================================
// REPORTS (AI scan)
// ============================================================

function ReportsSection() {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) { toast.error("attach a report first"); return; }
    if (file.size > 6 * 1024 * 1024) { toast.error("file too big — keep under 6MB"); return; }
    setBusy(true); setReply(null); setSources([]);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const s = String(r.result);
          const idx = s.indexOf(",");
          resolve(idx >= 0 ? s.slice(idx + 1) : s);
        };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const kind: "image" | "pdf" = file.type === "application/pdf" ? "pdf" : "image";
      const { data, error } = await supabase.functions.invoke("health-scan", {
        body: { kind, mime: file.type, data: b64, note },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.configured === false) { toast.error("AI not configured yet"); return; }
      setReply(String(data?.reply || ""));
      setSources(Array.isArray(data?.sources) ? data.sources : []);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-4 w-4 text-primary" />
        <h3 className="font-display text-base font-bold">reports 🧾</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-3">upload a photo or PDF of a lab/medical report — AI explains it in plain english.</p>

      <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button onClick={() => inputRef.current?.click()}
        className="press w-full flex items-center gap-2 rounded-2xl border border-dashed border-border bg-surface-2/40 p-3 text-sm">
        <Upload className="h-4 w-4" />
        <span className="flex-1 text-left truncate">{file ? file.name : "attach report (jpg/png/pdf)"}</span>
      </button>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="anything to know? (optional)"
        className="mt-2 w-full rounded-xl bg-surface-2 border border-border px-3 py-2 text-sm" />
      <button onClick={submit} disabled={busy || !file}
        className="press mt-3 w-full rounded-2xl bg-primary text-primary-foreground py-3 font-semibold disabled:opacity-60">
        {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />reading…</span> : "scan report"}
      </button>

      {reply && (
        <div className="mt-4 rounded-2xl bg-surface-2/60 p-3">
          <div className="text-xs uppercase tracking-wider text-primary mb-1">AI summary</div>
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{reply}</div>
          {sources.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase text-muted-foreground mb-1">sources</div>
              <ul className="space-y-1">
                {sources.slice(0, 6).map((s) => (
                  <li key={s}><a href={s} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline break-all">{s}</a></li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/30 p-2 text-[11px] text-amber-300">
            🩺 {DISCLAIMER}
          </div>
        </div>
      )}
    </section>
  );
}

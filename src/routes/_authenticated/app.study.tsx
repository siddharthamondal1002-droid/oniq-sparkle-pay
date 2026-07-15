import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Paperclip, X, Camera, Plus, Trash2, Pencil, Check, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { compressToJpeg } from "@/lib/imageCompress";

export const Route = createFileRoute("/_authenticated/app/study")({
  component: StudyScreen,
});

type Board = "cbse" | "icse" | "igcse" | "college";
type ClassLevel = "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "ug" | "pg";

type LearnerProfile = {
  id: string;
  name: string;
  board: Board;
  class_level: ClassLevel;
  created_at: string;
};

type Attachment = {
  kind: "image" | "pdf" | "text";
  mime: string;
  name: string;
  size: number;
  data?: string;
  text?: string;
  previewUrl?: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  attachment?: { kind: Attachment["kind"]; name: string; previewUrl?: string };
  usedVault?: boolean;
};

const BOARDS: { value: Board; label: string }[] = [
  { value: "cbse", label: "CBSE" },
  { value: "icse", label: "ICSE" },
  { value: "igcse", label: "IGCSE" },
  { value: "college", label: "College+" },
];

const CLASS_LEVELS: { value: ClassLevel; label: string }[] = [
  { value: "5", label: "Class 5" },
  { value: "6", label: "Class 6" },
  { value: "7", label: "Class 7" },
  { value: "8", label: "Class 8" },
  { value: "9", label: "Class 9" },
  { value: "10", label: "Class 10" },
  { value: "11", label: "Class 11" },
  { value: "12", label: "Class 12" },
  { value: "ug", label: "Undergraduate" },
  { value: "pg", label: "Postgraduate" },
];

const BOARD_UPPER: Record<Board, string> = {
  cbse: "CBSE",
  icse: "ICSE",
  igcse: "IGCSE",
  college: "College",
};

function subjectsFor(board: Board, cls: ClassLevel): string[] {
  if (cls === "ug" || cls === "pg" || board === "college") {
    return ["Maths", "Physics", "Chemistry", "Biology", "English", "Economics", "Computer Science", "General"];
  }
  const n = Number(cls);
  if (n >= 5 && n <= 8) {
    return ["Maths", "Science", "English", "Hindi", "Social Studies", "Computer"];
  }
  if (n === 9 || n === 10) {
    if (board === "icse") {
      return ["Maths", "Physics", "Chemistry", "Biology", "English", "History & Civics", "Geography", "Hindi", "Computer"];
    }
    if (board === "igcse") {
      return ["Maths", "Physics", "Chemistry", "Biology", "English", "Geography", "History", "Computer Science"];
    }
    return ["Maths", "Science", "English", "Hindi", "Social Science", "Computer"];
  }
  // 11–12
  return ["Physics", "Chemistry", "Maths", "Biology", "English", "Accounts", "Economics", "Business Studies", "Computer Science"];
}

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

function useLearnerProfiles() {
  return useQuery({
    queryKey: ["learner-profiles"],
    queryFn: async (): Promise<LearnerProfile[]> => {
      // Types are generated post-migration; cast here.
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{ data: LearnerProfile[] | null; error: Error | null }>;
          };
        };
      })
        .from("learner_profiles")
        .select("id, name, board, class_level, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

function StudyScreen() {
  const { data: profiles, isLoading } = useLearnerProfiles();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LearnerProfile | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    if (profiles && profiles.length > 0 && !activeId) {
      setActiveId(profiles[0].id);
    }
  }, [profiles, activeId]);

  const active = profiles?.find((p) => p.id === activeId) ?? null;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!profiles || profiles.length === 0) {
    return <SetupCard onCreated={(p) => setActiveId(p.id)} first />;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card/40 px-5 pt-12 pb-3 backdrop-blur">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-orange-400 to-pink-500 text-white">
          <span className="text-base">📚</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-semibold truncate">
            {active ? active.name : "Study Buddy"}
          </div>
          {active && (
            <div className="text-[10px] text-muted-foreground">
              {BOARD_UPPER[active.board]} · {active.class_level === "ug" ? "UG" : active.class_level === "pg" ? "PG" : `Class ${active.class_level}`}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowProgress(true)}
          aria-label="Progress"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <BarChart3 className="h-4 w-4" />
        </button>
      </header>

      {/* Profile chips */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-2 no-scrollbar">
        {profiles.map((p) => (
          <button
            key={p.id}
            onClick={() => setActiveId(p.id)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
              p.id === activeId
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border bg-card text-muted-foreground"
            }`}
          >
            {p.name}
          </button>
        ))}
        {active && (
          <button
            onClick={() => setEditing(active)}
            aria-label="Edit profile"
            className="shrink-0 grid h-7 w-7 place-items-center rounded-full border border-border bg-card text-muted-foreground"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={() => setShowAdd(true)}
          aria-label="Add learner"
          className="shrink-0 grid h-7 w-7 place-items-center rounded-full border border-border bg-card text-muted-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {active && <TutorChat profile={active} />}

      {showAdd && (
        <ModalCard onClose={() => setShowAdd(false)}>
          <SetupCard
            onCreated={(p) => {
              setActiveId(p.id);
              setShowAdd(false);
            }}
          />
        </ModalCard>
      )}

      {editing && (
        <ModalCard onClose={() => setEditing(null)}>
          <EditProfile
            profile={editing}
            onDone={() => setEditing(null)}
            onDeleted={() => {
              setActiveId(null);
              setEditing(null);
            }}
          />
        </ModalCard>
      )}

      {showProgress && profiles && (
        <ModalCard onClose={() => setShowProgress(false)}>
          <ProgressDashboard profiles={profiles} onClose={() => setShowProgress(false)} />
        </ModalCard>
      )}
    </div>
  );
}

function ModalCard({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function SetupCard({ onCreated, first = false }: { onCreated: (p: LearnerProfile) => void; first?: boolean }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [board, setBoard] = useState<Board>("cbse");
  const [classLevel, setClassLevel] = useState<ClassLevel>("8");

  const create = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("please enter a name");
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not signed in");
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          insert: (row: unknown) => {
            select: (c: string) => {
              single: () => Promise<{ data: LearnerProfile | null; error: Error | null }>;
            };
          };
        };
      })
        .from("learner_profiles")
        .insert({ user_id: u.user.id, name: trimmed, board, class_level: classLevel })
        .select("id, name, board, class_level, created_at")
        .single();
      if (error || !data) throw error ?? new Error("failed");
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["learner-profiles"] });
      onCreated(data);
      toast.success("all set — let's learn 📚");
    },
    onError: (e) => toast.error((e as Error).message || "couldn't create profile"),
  });

  return (
    <div className={first ? "mx-auto mt-24 max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl" : "rounded-3xl border border-border bg-card p-6 shadow-2xl"}>
      <div className="text-3xl">🎒</div>
      <h2 className="mt-2 font-display text-xl font-bold">who's studying today?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Set up a learner profile so Study Buddy teaches at the right level.
      </p>

      <label className="mt-5 block text-xs font-medium text-muted-foreground">Learner name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 40))}
        placeholder="e.g. Aarav"
        className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none"
      />

      <label className="mt-4 block text-xs font-medium text-muted-foreground">Board</label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {BOARDS.map((b) => (
          <button
            key={b.value}
            onClick={() => setBoard(b.value)}
            className={`rounded-xl border px-3 py-2 text-sm transition ${
              board === b.value ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-medium text-muted-foreground">Class</label>
      <select
        value={classLevel}
        onChange={(e) => setClassLevel(e.target.value as ClassLevel)}
        className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none"
      >
        {CLASS_LEVELS.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      <button
        onClick={() => create.mutate()}
        disabled={create.isPending || !name.trim()}
        className="mt-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {create.isPending ? "Creating…" : "Start learning"}
      </button>
    </div>
  );
}

function EditProfile({
  profile,
  onDone,
  onDeleted,
}: {
  profile: LearnerProfile;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [board, setBoard] = useState<Board>(profile.board);
  const [classLevel, setClassLevel] = useState<ClassLevel>(profile.class_level);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("name required");
      const { error } = await (supabase as unknown as {
        from: (t: string) => {
          update: (row: unknown) => {
            eq: (col: string, val: string) => Promise<{ error: Error | null }>;
          };
        };
      })
        .from("learner_profiles")
        .update({ name: trimmed, board, class_level: classLevel })
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["learner-profiles"] });
      toast.success("updated");
      onDone();
    },
    onError: (e) => toast.error((e as Error).message || "couldn't save"),
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as unknown as {
        from: (t: string) => {
          delete: () => { eq: (col: string, val: string) => Promise<{ error: Error | null }> };
        };
      })
        .from("learner_profiles")
        .delete()
        .eq("id", profile.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["learner-profiles"] });
      toast.success("removed");
      onDeleted();
    },
    onError: (e) => toast.error((e as Error).message || "couldn't delete"),
  });

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-2xl">
      <h2 className="font-display text-lg font-bold">Edit learner</h2>

      <label className="mt-4 block text-xs font-medium text-muted-foreground">Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 40))}
        className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none"
      />

      <label className="mt-4 block text-xs font-medium text-muted-foreground">Board</label>
      <div className="mt-1 grid grid-cols-2 gap-2">
        {BOARDS.map((b) => (
          <button
            key={b.value}
            onClick={() => setBoard(b.value)}
            className={`rounded-xl border px-3 py-2 text-sm transition ${
              board === b.value ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <label className="mt-4 block text-xs font-medium text-muted-foreground">Class</label>
      <select
        value={classLevel}
        onChange={(e) => setClassLevel(e.target.value as ClassLevel)}
        className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none"
      >
        {CLASS_LEVELS.map((c) => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      <div className="mt-6 flex gap-2">
        <button
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border text-red-400 hover:bg-red-500/10"
          aria-label="Delete profile"
        >
          <Trash2 className="h-4 w-4" />
        </button>
        <button
          onClick={onDone}
          className="flex-1 rounded-xl border border-border py-3 text-sm"
        >
          Cancel
        </button>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !name.trim()}
          className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          <Check className="mr-1 inline h-4 w-4" /> Save
        </button>
      </div>
    </div>
  );
}

function TutorChat({ profile }: { profile: LearnerProfile }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [notConfigured, setNotConfigured] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [quizSubject, setQuizSubject] = useState<string | null>(null);
  const [paperSpec, setPaperSpec] = useState<{ subject: string; totalMarks: 30 | 80 | 100 } | null>(null);
  const [showQuizPicker, setShowQuizPicker] = useState(false);
  const [pickerSubject, setPickerSubject] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const subjects = subjectsFor(profile.board, profile.class_level);

  // Hydrate chat history from study_messages when the active profile changes.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setInput("");
    setAttachment(null);
    setHydrating(true);
    (async () => {
      try {
        const { data, error } = await (supabase as unknown as {
          from: (t: string) => {
            select: (c: string) => {
              eq: (col: string, val: string) => {
                order: (col: string, opts: { ascending: boolean }) => {
                  limit: (n: number) => Promise<{ data: { role: "user" | "assistant"; content: string; used_vault: boolean }[] | null; error: Error | null }>;
                };
              };
            };
          };
        })
          .from("study_messages")
          .select("role, content, used_vault")
          .eq("profile_id", profile.id)
          .order("created_at", { ascending: true })
          .limit(50);
        if (cancelled) return;
        if (error) throw error;
        const rows = data ?? [];
        setMessages(rows.map((r) => ({ role: r.role, content: r.content, usedVault: !!r.used_vault })));
      } catch {
        // best-effort — start with empty chat
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function persistExchange(userContent: string, assistantContent: string, usedVault: boolean) {
    try {
      await (supabase as unknown as {
        from: (t: string) => {
          insert: (rows: unknown) => Promise<{ error: Error | null }>;
        };
      }).from("study_messages").insert([
        { profile_id: profile.id, role: "user", content: userContent, used_vault: false },
        { profile_id: profile.id, role: "assistant", content: assistantContent, used_vault: usedVault },
      ]);
    } catch {
      // best-effort
    }
  }

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const mime = f.type || "";
    try {
      if (mime.startsWith("image/")) {
        if (f.size > 5 * 1024 * 1024) return toast.error("images must be under 5MB");
        const { base64, dataUrl } = await compressToJpeg(f, 1024, 0.7);
        setAttachment({ kind: "image", mime: "image/jpeg", name: f.name, size: f.size, data: base64, previewUrl: dataUrl });
      } else if (mime === "application/pdf" || /\.pdf$/i.test(f.name)) {
        if (f.size > 10 * 1024 * 1024) return toast.error("PDFs must be under 10MB");
        const data = await fileToBase64(f);
        setAttachment({ kind: "pdf", mime: "application/pdf", name: f.name, size: f.size, data });
      } else if (mime.startsWith("text/") || /\.(txt|md|csv)$/i.test(f.name)) {
        if (f.size > 1 * 1024 * 1024) return toast.error("text files must be under 1MB");
        const text = await f.text();
        setAttachment({ kind: "text", mime: mime || "text/plain", name: f.name, size: f.size, text });
      } else {
        toast.error("please attach an image, PDF, or text file");
      }
    } catch {
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
    setLoading(true);
    try {
      const payload = next.slice(-20).map((m) => {
        const raw = (m.content ?? "").trim();
        if (raw) return { role: m.role, content: raw };
        if (m.attachment) {
          const kind = m.attachment.kind === "pdf" ? "PDF" : m.attachment.kind === "text" ? "text file" : "image";
          return { role: m.role, content: `(shared a ${kind})` };
        }
        return { role: m.role, content: "(no message)" };
      });
      const body: Record<string, unknown> = {
        messages: payload,
        profile: { name: profile.name, board: profile.board, classLevel: profile.class_level },
      };
      try {
        const { getUserLanguage } = await import("@/lib/userLanguage");
        body.lang = await getUserLanguage();
      } catch { /* English */ }
      if (att) {
        body.attachment = att.kind === "text"
          ? { kind: "text", text: att.text }
          : { kind: att.kind, mime: att.mime, data: att.data };
      }
      const { data, error } = await supabase.functions.invoke("study-tutor", { body });
      if (error) throw error;
      const d = data as { configured?: boolean; reply?: string; error?: string; usedVault?: boolean };
      if (d?.configured === false) {
        setNotConfigured(true);
        setMessages(messages);
        return;
      }
      if (d?.error) throw new Error(d.error);
      const reply = d?.reply ?? "";
      const usedVault = !!d?.usedVault;
      setMessages([...next, { role: "assistant", content: reply, usedVault }]);
      // Persist the exchange. For attachments, store a short placeholder
      // in place of binary data — matches the tutor payload convention.
      const storedUser = text.trim() || (att
        ? `(shared a ${att.kind === "pdf" ? "PDF" : att.kind === "text" ? "text file" : "image"})`
        : "(no message)");
      void persistExchange(storedUser, reply, usedVault);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast.error(msg && !/non-2xx/i.test(msg) ? msg : "Study Buddy tripped — please try again 🌿");
    } finally {
      setLoading(false);
    }
  }

  const canSend = !loading && (input.trim().length > 0 || !!attachment);

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
        {notConfigured ? (
          <div className="mx-auto mt-8 max-w-sm rounded-2xl border border-border bg-card p-5 text-center">
            <div className="text-4xl">📚</div>
            <h2 className="mt-2 font-display text-lg font-bold">Study Buddy needs a key</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add <code className="rounded bg-muted px-1">ANTHROPIC_API_KEY</code> in project secrets.
            </p>
          </div>
        ) : hydrating ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            loading your chat…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-3xl bg-gradient-to-br from-orange-400 to-pink-500 text-white">
              <span className="text-3xl">📚</span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold">Hi {profile.name} 👋</h2>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              ask me anything from your syllabus — or snap a photo of the problem 📸
            </p>
          </div>
        ) : (
          <div className="space-y-3 pb-4">
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
                      className={`whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card"
                      }`}
                    >
                      {m.content}
                    </div>
                  )}
                  {m.role === "assistant" && m.usedVault && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      📚 from the ONIQ study vault
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
          {/* Subject chips + practice quiz */}
          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setShowQuizPicker(true)}
              className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
            >
              practice quiz 📝
            </button>
            {subjects.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setInput(`Help me with ${s}: `)}
                className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {s}
              </button>
            ))}
          </div>
          {showQuizPicker && (
            <ModalCard
              onClose={() => {
                setShowQuizPicker(false);
                setPickerSubject(null);
              }}
            >
              <div className="rounded-3xl border border-border bg-card p-6 shadow-2xl">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">practice</div>
                    <div className="font-display text-lg font-bold">
                      {pickerSubject ? "pick a format 📝" : "pick a subject 📝"}
                    </div>
                    {pickerSubject && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{pickerSubject}</div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setShowQuizPicker(false);
                      setPickerSubject(null);
                    }}
                    aria-label="Close"
                    className="grid h-8 w-8 place-items-center rounded-full border border-border"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {!pickerSubject ? (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {subjects.map((s) => (
                      <button
                        key={s}
                        onClick={() => setPickerSubject(s)}
                        className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    <button
                      onClick={() => {
                        setShowQuizPicker(false);
                        setQuizSubject(pickerSubject);
                        setPickerSubject(null);
                      }}
                      className="w-full rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-left hover:bg-primary/15"
                    >
                      <div className="text-sm font-semibold text-primary">quick quiz</div>
                      <div className="text-[11px] text-muted-foreground">5 multiple-choice questions</div>
                    </button>
                    {([30, 80, 100] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => {
                          setShowQuizPicker(false);
                          setPaperSpec({ subject: pickerSubject, totalMarks: m });
                          setPickerSubject(null);
                        }}
                        className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
                      >
                        <div className="text-sm font-semibold">full paper · {m} marks</div>
                        <div className="text-[11px] text-muted-foreground">
                          {m === 30 ? "MCQs, short & long answers · ~30 min"
                            : m === 80 ? "MCQs, short & long answers · ~2 hr"
                            : "MCQs, short & long answers · ~3 hr"}
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={() => setPickerSubject(null)}
                      className="w-full rounded-xl border border-border py-2 text-[11px] text-muted-foreground"
                    >
                      ← change subject
                    </button>
                  </div>
                )}
              </div>
            </ModalCard>
          )}
          {quizSubject && (
            <QuizModal
              profile={profile}
              initialSubject={quizSubject}
              onClose={() => setQuizSubject(null)}
            />
          )}
          {paperSpec && (
            <PaperModal
              profile={profile}
              subject={paperSpec.subject}
              totalMarks={paperSpec.totalMarks}
              onClose={() => setPaperSpec(null)}
            />
          )}


          {attachment && (
            <div className="mb-2 flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 text-xs w-fit">
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

          <div className="flex items-center gap-1 rounded-full border border-border bg-input/40 pl-2 pr-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,.txt,.md,.csv"
              hidden
              onChange={handlePick}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={handlePick}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              aria-label="Attach"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={loading}
              aria-label="Camera"
              className="grid h-9 w-9 place-items-center rounded-full hover:bg-muted disabled:opacity-40"
            >
              <Camera className="h-4 w-4" />
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ask about your lesson…"
              disabled={loading}
              className="flex-1 bg-transparent py-3 text-sm placeholder:text-muted-foreground focus:outline-none"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="grid h-9 w-9 place-items-center rounded-full bg-accent text-accent-foreground disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      )}
    </>
  );
}

// ------------------------- Quiz -------------------------

type QuizQ = { question: string; options: string[]; correct_index: number; explanation: string };

function QuizModal({
  profile,
  initialSubject,
  onClose,
}: {
  profile: LearnerProfile;
  initialSubject: string;
  onClose: () => void;
}) {
  const [subject] = useState(initialSubject);
  const [topic] = useState(initialSubject);
  const [questions, setQuestions] = useState<QuizQ[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [done, setDone] = useState(false);
  const insertedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { data, error } = await supabase.functions.invoke("study-quiz", {
          body: {
            profile: { board: profile.board, classLevel: profile.class_level },
            subject,
            topic,
          },
        });
        if (cancelled) return;
        if (error) throw error;
        const d = data as { source?: string; questions?: QuizQ[]; reason?: string };
        if (d?.source === "quiz" && Array.isArray(d.questions) && d.questions.length === 5) {
          setQuestions(d.questions);
        } else {
          setErrorMsg("couldn't build that quiz — try again");
        }
      } catch {
        if (!cancelled) setErrorMsg("couldn't build that quiz — try again");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.board, profile.class_level, subject, topic]);

  async function saveAttempt(finalCorrect: number) {
    if (insertedRef.current) return;
    insertedRef.current = true;
    try {
      await (supabase as unknown as {
        from: (t: string) => {
          insert: (row: unknown) => Promise<{ error: Error | null }>;
        };
      }).from("quiz_attempts").insert({
        profile_id: profile.id,
        subject,
        topic,
        total_questions: 5,
        correct_count: finalCorrect,
      });
    } catch {
      // best-effort
    }
  }

  function choose(i: number) {
    if (picked !== null || !questions) return;
    setPicked(i);
    if (i === questions[idx].correct_index) setCorrect((c) => c + 1);
  }

  function next() {
    if (!questions) return;
    if (idx + 1 >= questions.length) {
      const finalCorrect = correct;
      setDone(true);
      void saveAttempt(finalCorrect);
    } else {
      setIdx(idx + 1);
      setPicked(null);
    }
  }

  const q = questions?.[idx] ?? null;
  const isCorrect = q && picked !== null && picked === q.correct_index;

  return (
    <div className="rounded-3xl border border-border bg-card p-6 shadow-2xl">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">practice quiz</div>
          <div className="font-display text-lg font-bold">{subject}</div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="grid h-8 w-8 place-items-center rounded-full border border-border"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {loading && (
        <div className="mt-8 text-center text-sm text-muted-foreground">
          quiz is warming up… 📝
        </div>
      )}

      {!loading && errorMsg && (
        <div className="mt-8 text-center">
          <div className="text-3xl">🌿</div>
          <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
          <button
            onClick={onClose}
            className="mt-4 rounded-xl border border-border px-4 py-2 text-sm"
          >
            close
          </button>
        </div>
      )}

      {!loading && !errorMsg && q && !done && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Question {idx + 1} of 5</span>
            <span>Score: {correct}</span>
          </div>
          <div className="mt-3 text-sm font-medium">{q.question}</div>
          <div className="mt-4 space-y-2">
            {q.options.map((opt, i) => {
              const isPicked = picked === i;
              const isAnswer = picked !== null && i === q.correct_index;
              const isWrongPick = picked !== null && isPicked && i !== q.correct_index;
              return (
                <button
                  key={i}
                  onClick={() => choose(i)}
                  disabled={picked !== null}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                    isAnswer
                      ? "border-green-500/50 bg-green-500/10 text-green-300"
                      : isWrongPick
                      ? "border-red-500/50 bg-red-500/10 text-red-300"
                      : isPicked
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {picked !== null && (
            <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
              isCorrect ? "border-green-500/30 bg-green-500/5 text-green-300" : "border-border bg-muted/40 text-muted-foreground"
            }`}>
              <div className="font-medium">
                {isCorrect ? "nice one! ✨" : "not this time — here's why"}
              </div>
              <div className="mt-1">{q.explanation}</div>
            </div>
          )}
          {picked !== null && (
            <button
              onClick={next}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
            >
              {idx + 1 >= 5 ? "see results" : "next question"}
            </button>
          )}
        </div>
      )}

      {done && questions && (
        <div className="mt-4 text-center">
          <div className="text-4xl">
            {correct === 5 ? "🏆" : correct >= 3 ? "🎉" : "🌱"}
          </div>
          <div className="mt-2 font-display text-xl font-bold">
            you got {correct}/5!
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {correct === 5
              ? "flawless — a proper study champion."
              : correct >= 3
              ? "solid work — keep at it, you're building real understanding."
              : "great start — every attempt makes the next one easier 💪"}
          </p>
          <button
            onClick={onClose}
            className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            done
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------- Full Paper -------------------------

type PaperQClient =
  | { id: string; type: "mcq"; marks: number; question: string; options: string[] }
  | { id: string; type: "short" | "long"; marks: number; question: string };

type GradeResult = {
  awarded_marks: number;
  max_marks: number;
  feedback: string;
  correct_index?: number;
};

function PaperModal({
  profile,
  subject,
  totalMarks,
  onClose,
}: {
  profile: LearnerProfile;
  subject: string;
  totalMarks: 30 | 80 | 100;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PaperQClient[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [mcqPick, setMcqPick] = useState<number | null>(null);
  const [written, setWritten] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradeResult, setGradeResult] = useState<GradeResult | null>(null);
  const [totalScored, setTotalScored] = useState(0);
  const [done, setDone] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { data, error } = await supabase.functions.invoke("study-paper-generate", {
          body: {
            profile: { board: profile.board, classLevel: profile.class_level },
            profileId: profile.id,
            subject,
            totalMarks,
          },
        });
        if (cancelled) return;
        if (error) throw error;
        const d = data as { source?: string; paper_id?: string; questions?: PaperQClient[]; reason?: string };
        if (d?.source === "paper" && d.paper_id && Array.isArray(d.questions) && d.questions.length > 0) {
          setPaperId(d.paper_id);
          setQuestions(d.questions);
        } else {
          setErrorMsg("couldn't build that paper — try again 🌿");
        }
      } catch {
        if (!cancelled) setErrorMsg("couldn't build that paper — try again 🌿");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.id, profile.board, profile.class_level, subject, totalMarks]);

  const q = questions?.[idx] ?? null;
  const isLast = questions ? idx + 1 >= questions.length : false;

  async function submitAnswer() {
    if (!q || !paperId || grading) return;
    setGrading(true);
    try {
      const answer: string | number = q.type === "mcq" ? (mcqPick ?? -1) : written.trim();
      const { data, error } = await supabase.functions.invoke("study-paper-grade", {
        body: { paper_id: paperId, question_id: q.id, answer },
      });
      if (error) throw error;
      const d = data as GradeResult & { source?: string; reason?: string };
      if (typeof d.awarded_marks !== "number") {
        toast.error("couldn't grade that one — try again");
        return;
      }
      setGradeResult({
        awarded_marks: d.awarded_marks,
        max_marks: d.max_marks ?? q.marks,
        feedback: d.feedback ?? "",
        correct_index: d.correct_index,
      });
      setTotalScored((s) => s + d.awarded_marks);
    } catch {
      toast.error("couldn't grade that one — try again");
    } finally {
      setGrading(false);
    }
  }

  async function next() {
    if (!questions) return;
    if (isLast) {
      setDone(true);
      if (!finishedRef.current && paperId) {
        finishedRef.current = true;
        setFinishing(true);
        try {
          await supabase.functions.invoke("study-paper-finish", {
            body: { paper_id: paperId, marks_scored: totalScored, total_marks: totalMarks, subject },
          });
        } catch { /* best-effort */ }
        finally { setFinishing(false); }
      }
    } else {
      setIdx(idx + 1);
      setMcqPick(null);
      setWritten("");
      setGradeResult(null);
    }
  }

  const pct = totalMarks > 0 ? Math.round((totalScored / totalMarks) * 100) : 0;

  return (
    <ModalCard onClose={onClose}>
      <div className="max-h-[85vh] overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">practice paper</div>
            <div className="font-display text-lg font-bold">{subject} · {totalMarks} marks</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full border border-border">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && (
          <div className="mt-10 text-center text-sm text-muted-foreground">
            building your paper… 📄
          </div>
        )}

        {!loading && errorMsg && (
          <div className="mt-8 text-center">
            <div className="text-3xl">🌿</div>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
            <button onClick={onClose} className="mt-4 rounded-xl border border-border px-4 py-2 text-sm">close</button>
          </div>
        )}

        {!loading && !errorMsg && q && !done && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Question {idx + 1} of {questions?.length ?? 0} · {q.marks} {q.marks === 1 ? "mark" : "marks"}</span>
              <span>Score: {totalScored}/{totalMarks}</span>
            </div>
            <div className="mt-3 text-sm font-medium whitespace-pre-wrap">{q.question}</div>

            {q.type === "mcq" ? (
              <div className="mt-4 space-y-2">
                {q.options.map((opt, i) => {
                  const picked = mcqPick === i;
                  const graded = gradeResult !== null;
                  const isAnswer = graded && gradeResult?.correct_index === i;
                  const isWrongPick = graded && picked && gradeResult?.correct_index !== i;
                  return (
                    <button
                      key={i}
                      disabled={graded}
                      onClick={() => setMcqPick(i)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                        isAnswer
                          ? "border-green-500/50 bg-green-500/10 text-green-300"
                          : isWrongPick
                          ? "border-red-500/50 bg-red-500/10 text-red-300"
                          : picked
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4">
                <textarea
                  value={written}
                  onChange={(e) => setWritten(e.target.value.slice(0, 6000))}
                  disabled={gradeResult !== null}
                  placeholder={q.type === "long" ? "write your full answer here…" : "write your short answer here…"}
                  rows={q.type === "long" ? 8 : 5}
                  className="w-full rounded-xl border border-border bg-input/40 px-3 py-2.5 text-sm focus:outline-none disabled:opacity-70"
                />
                <div className="mt-1 text-[10px] text-muted-foreground text-right">{written.length}/6000</div>
              </div>
            )}

            {gradeResult && (
              <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                gradeResult.awarded_marks === gradeResult.max_marks
                  ? "border-green-500/30 bg-green-500/5 text-green-300"
                  : gradeResult.awarded_marks > 0
                  ? "border-yellow-500/30 bg-yellow-500/5 text-yellow-200"
                  : "border-border bg-muted/40 text-muted-foreground"
              }`}>
                <div className="font-medium">
                  {gradeResult.awarded_marks}/{gradeResult.max_marks} · {
                    gradeResult.awarded_marks === gradeResult.max_marks ? "full marks ✨"
                    : gradeResult.awarded_marks > 0 ? "partial credit"
                    : "no marks this time"
                  }
                </div>
                {gradeResult.feedback && <div className="mt-1">{gradeResult.feedback}</div>}
              </div>
            )}

            {!gradeResult ? (
              <button
                onClick={submitAnswer}
                disabled={grading || (q.type === "mcq" ? mcqPick === null : written.trim().length === 0)}
                className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                {grading ? "grading…" : "submit answer"}
              </button>
            ) : (
              <button
                onClick={next}
                className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                {isLast ? "see results" : "next question"}
              </button>
            )}
          </div>
        )}

        {done && (
          <div className="mt-4 text-center">
            <div className="text-4xl">
              {pct >= 90 ? "🏆" : pct >= 60 ? "🎉" : "🌱"}
            </div>
            <div className="mt-2 font-display text-xl font-bold">
              you scored {totalScored}/{totalMarks}!
            </div>
            <div className="text-xs text-muted-foreground">that's {pct}%</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {pct >= 90
                ? "outstanding — you know this cold."
                : pct >= 60
                ? "solid work — real understanding showing through."
                : "great practice — every attempt makes the next one easier 💪"}
            </p>
            {finishing && <div className="mt-2 text-[10px] text-muted-foreground">saving…</div>}
            <button
              onClick={onClose}
              disabled={finishing}
              className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              done
            </button>
          </div>
        )}
      </div>
    </ModalCard>
  );
}

// ------------------------- Progress -------------------------

type Attempt = {
  id: string;
  profile_id: string;
  subject: string;
  topic: string;
  total_questions: number | null;
  correct_count: number | null;
  total_marks: number | null;
  marks_scored: number | null;
  created_at: string;
};


function useAttempts() {
  return useQuery({
    queryKey: ["quiz-attempts"],
    queryFn: async (): Promise<Attempt[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{ data: Attempt[] | null; error: Error | null }>;
          };
        };
      })
        .from("quiz_attempts")
        .select("id, profile_id, subject, topic, total_questions, correct_count, total_marks, marks_scored, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

// Normalize a quiz_attempts row to a unified numerator/denominator regardless
// of whether it's a quick 5-Q quiz (total_questions/correct_count) or a full
// paper (total_marks/marks_scored).
function attemptScore(r: Attempt): { num: number; den: number } {
  if (r.total_marks && r.total_marks > 0) {
    return { num: Math.max(0, r.marks_scored ?? 0), den: r.total_marks };
  }
  if (r.total_questions && r.total_questions > 0) {
    return { num: Math.max(0, r.correct_count ?? 0), den: r.total_questions };
  }
  return { num: 0, den: 0 };
}

function ProgressDashboard({ profiles, onClose }: { profiles: LearnerProfile[]; onClose: () => void }) {
  const { data: attempts, isLoading } = useAttempts();

  function statsFor(profileId: string) {
    const rows = (attempts ?? []).filter((a) => a.profile_id === profileId);
    let totalNum = 0, totalDen = 0;
    for (const r of rows) {
      const { num, den } = attemptScore(r);
      totalNum += num; totalDen += den;
    }
    const acc = totalDen > 0 ? Math.round((totalNum / totalDen) * 100) : 0;

    const bySubject = new Map<string, { attempts: number; num: number; den: number }>();
    for (const r of rows) {
      const { num, den } = attemptScore(r);
      const cur = bySubject.get(r.subject) ?? { attempts: 0, num: 0, den: 0 };
      cur.attempts += 1;
      cur.num += num;
      cur.den += den;
      bySubject.set(r.subject, cur);
    }
    const subjects = Array.from(bySubject.entries()).map(([subject, s]) => ({
      subject,
      attempts: s.attempts,
      accuracy: s.den > 0 ? Math.round((s.num / s.den) * 100) : 0,
    }));

    // streak: distinct calendar days in the last 14 days
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - 14);
    const days = new Set<string>();
    for (const r of rows) {
      const d = new Date(r.created_at);
      if (d >= cutoff) days.add(d.toISOString().slice(0, 10));
    }

    const recent = rows.slice(0, 5);
    return {
      totalAttempts: rows.length,
      accuracy: acc,
      subjects,
      streak: days.size,
      recent,
    };
  }


  return (
    <div className="max-h-[85vh] overflow-y-auto rounded-3xl border border-border bg-card p-5 shadow-2xl">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">progress</div>
          <h2 className="font-display text-lg font-bold">learning journey 📊</h2>
        </div>
        <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full border border-border">
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading && (
        <div className="mt-8 text-center text-sm text-muted-foreground">loading progress…</div>
      )}

      {!isLoading && (
        <div className="mt-4 space-y-5">
          {profiles.map((p) => {
            const s = statsFor(p.id);
            return (
              <div key={p.id} className="rounded-2xl border border-border bg-background/40 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {BOARD_UPPER[p.board]} · {p.class_level === "ug" ? "UG" : p.class_level === "pg" ? "PG" : `Class ${p.class_level}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-display font-bold">{s.accuracy}%</div>
                    <div className="text-[10px] text-muted-foreground">accuracy</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl border border-border bg-card p-2">
                    <div className="text-base font-semibold">{s.totalAttempts}</div>
                    <div className="text-[10px] text-muted-foreground">quizzes</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-2">
                    <div className="text-base font-semibold">{s.streak} 🔥</div>
                    <div className="text-[10px] text-muted-foreground">days (14d)</div>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-2">
                    <div className="text-base font-semibold">{s.subjects.length}</div>
                    <div className="text-[10px] text-muted-foreground">subjects</div>
                  </div>
                </div>

                {s.totalAttempts === 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    no quizzes yet — tap "practice quiz 📝" to get started ✨
                  </p>
                )}

                {s.subjects.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-medium text-muted-foreground">by subject</div>
                    <div className="mt-1 space-y-1">
                      {s.subjects.map((sub) => (
                        <div key={sub.subject} className="flex items-center justify-between text-xs">
                          <span>{sub.subject}</span>
                          <span className="text-muted-foreground">
                            {sub.attempts} {sub.attempts === 1 ? "quiz" : "quizzes"} · {sub.accuracy}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {s.recent.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-medium text-muted-foreground">recent attempts</div>
                    <div className="mt-1 space-y-1">
                      {s.recent.map((r) => {
                        const d = new Date(r.created_at);
                        const when = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
                        return (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="truncate">{r.subject}</span>
                            <span className="text-muted-foreground">
                              {when} · {r.correct_count}/{r.total_questions}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


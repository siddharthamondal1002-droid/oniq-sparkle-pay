import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Paperclip, X, Camera, Plus, Trash2, Pencil, Check } from "lucide-react";
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
        <div className="min-w-0">
          <div className="font-display text-base font-semibold truncate">
            {active ? active.name : "Study Buddy"}
          </div>
          {active && (
            <div className="text-[10px] text-muted-foreground">
              {BOARD_UPPER[active.board]} · {active.class_level === "ug" ? "UG" : active.class_level === "pg" ? "PG" : `Class ${active.class_level}`}
            </div>
          )}
        </div>
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
  const [notConfigured, setNotConfigured] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const subjects = subjectsFor(profile.board, profile.class_level);

  // Reset chat when switching profiles
  useEffect(() => {
    setMessages([]);
    setInput("");
    setAttachment(null);
  }, [profile.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

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
      const d = data as { configured?: boolean; reply?: string; error?: string };
      if (d?.configured === false) {
        setNotConfigured(true);
        setMessages(messages);
        return;
      }
      if (d?.error) throw new Error(d.error);
      setMessages([...next, { role: "assistant", content: d?.reply ?? "" }]);
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
          {/* Subject chips */}
          <div className="mb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
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

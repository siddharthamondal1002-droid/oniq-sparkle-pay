import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Send, Paperclip, X, Camera, Plus, Trash2, Pencil, Check, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { compressToJpeg } from "@/lib/imageCompress";

export const Route = createFileRoute("/_authenticated/app/study")({
  component: StudyScreen,
});

type Board =
  | "cbse" | "icse" | "igcse" | "ib" | "college" | "jee" | "neet" | "clat"
  | "govt_exam" | "govt_railway" | "govt_banking" | "govt_police"
  | "govt_judiciary" | "govt_ssc" | "govt_psc"
  | "nios" | "up_board" | "bihar_board" | "rajasthan_board" | "mp_board"
  | "haryana_board" | "punjab_board" | "uttarakhand_board" | "himachal_board"
  | "jk_board" | "jharkhand_board" | "chhattisgarh_board"
  | "maharashtra_board" | "tn_board" | "kerala_board" | "wb_board"
  | "gujarat_board" | "karnataka_board" | "ap_board" | "telangana_board";
type ClassLevel = "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "ug" | "pg" | "drop" | "aspirant";

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

// School / entrance-exam boards shown as direct chips in the picker.
const SCHOOL_BOARDS: { value: Board; label: string }[] = [
  { value: "cbse", label: "CBSE" },
  { value: "icse", label: "ICSE" },
  { value: "igcse", label: "IGCSE" },
  { value: "ib", label: "IB 🌐" },
  { value: "college", label: "College+" },
  { value: "jee", label: "JEE 🎯" },
  { value: "neet", label: "NEET 🩺" },
  { value: "clat", label: "CLAT / Law 📖" },
];

// Govt-family sub-tracks (revealed after choosing "Govt / Competitive Exams").
const GOVT_TRACKS: { value: Board; label: string }[] = [
  { value: "govt_railway", label: "Railways 🚆" },
  { value: "govt_banking", label: "Banking 🏦" },
  { value: "govt_police", label: "Police 👮" },
  { value: "govt_judiciary", label: "Judiciary ⚖️" },
  { value: "govt_ssc", label: "SSC 📝" },
  { value: "govt_psc", label: "PSC 🏛️" },
  { value: "govt_exam", label: "General 🏛️" },
];

// State boards + NIOS (revealed after tapping "State Boards"). All use the same
// class-level set as CBSE/ICSE (5–12); study-chapters is board-agnostic.
const STATE_BOARDS: { value: Board; label: string }[] = [
  { value: "nios", label: "NIOS 🏫" },
  { value: "up_board", label: "UP Board 🗺️" },
  { value: "bihar_board", label: "Bihar Board 🗺️" },
  { value: "rajasthan_board", label: "Rajasthan Board 🗺️" },
  { value: "mp_board", label: "MP Board 🗺️" },
  { value: "haryana_board", label: "Haryana Board 🗺️" },
  { value: "punjab_board", label: "Punjab Board 🗺️" },
  { value: "uttarakhand_board", label: "Uttarakhand Board 🗺️" },
  { value: "himachal_board", label: "Himachal Board 🗺️" },
  { value: "jk_board", label: "J&K Board 🗺️" },
  { value: "jharkhand_board", label: "Jharkhand Board 🗺️" },
  { value: "chhattisgarh_board", label: "Chhattisgarh Board 🗺️" },
  { value: "maharashtra_board", label: "Maharashtra Board 🗺️" },
  { value: "tn_board", label: "Tamil Nadu Board 🗺️" },
  { value: "kerala_board", label: "Kerala Board 🗺️" },
  { value: "wb_board", label: "West Bengal Board 🗺️" },
  { value: "gujarat_board", label: "Gujarat Board 🗺️" },
  { value: "karnataka_board", label: "Karnataka Board 🗺️" },
  { value: "ap_board", label: "Andhra Pradesh Board 🗺️" },
  { value: "telangana_board", label: "Telangana Board 🗺️" },
];

function isGovtBoard(b: Board): boolean {
  return b.startsWith("govt");
}

function isStateBoard(b: Board): boolean {
  return b === "nios" || b.endsWith("_board");
}

const ALL_CLASS_LEVELS: { value: ClassLevel; label: string }[] = [
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
  { value: "drop", label: "Drop year" },
  { value: "aspirant", label: "Aspirant" },
];

function classLevelsFor(board: Board): { value: ClassLevel; label: string }[] {
  if (board === "jee" || board === "neet" || board === "clat") {
    return [
      { value: "11", label: "Class 11" },
      { value: "12", label: "Class 12" },
      { value: "drop", label: "Drop year" },
    ];
  }
  if (isGovtBoard(board)) {
    return [
      { value: "11", label: "Class 11" },
      { value: "12", label: "Class 12" },
      { value: "drop", label: "Drop year" },
      { value: "ug", label: "Undergraduate" },
      { value: "pg", label: "Postgraduate" },
      { value: "aspirant", label: "Aspirant" },
    ];
  }
  return ALL_CLASS_LEVELS.filter((c) => c.value !== "drop" && c.value !== "aspirant");
}

const BOARD_UPPER: Record<Board, string> = {
  cbse: "CBSE",
  icse: "ICSE",
  igcse: "IGCSE",
  ib: "IB",
  college: "College",
  jee: "JEE",
  neet: "NEET",
  clat: "CLAT",
  govt_exam: "Govt Exams",
  govt_railway: "Railways",
  govt_banking: "Banking",
  govt_police: "Police",
  govt_judiciary: "Judiciary",
  govt_ssc: "SSC",
  govt_psc: "PSC",
  nios: "NIOS",
  up_board: "UP Board",
  bihar_board: "Bihar Board",
  rajasthan_board: "Rajasthan Board",
  mp_board: "MP Board",
  haryana_board: "Haryana Board",
  punjab_board: "Punjab Board",
  uttarakhand_board: "Uttarakhand Board",
  himachal_board: "Himachal Board",
  jk_board: "J&K Board",
  jharkhand_board: "Jharkhand Board",
  chhattisgarh_board: "Chhattisgarh Board",
  maharashtra_board: "Maharashtra Board",
  tn_board: "Tamil Nadu Board",
  kerala_board: "Kerala Board",
  wb_board: "West Bengal Board",
  gujarat_board: "Gujarat Board",
  karnataka_board: "Karnataka Board",
  ap_board: "Andhra Pradesh Board",
  telangana_board: "Telangana Board",
};

const BOARD_EMOJI: Record<Board, string> = {
  cbse: "", icse: "", igcse: "", ib: "🌐", college: "", jee: "🎯", neet: "🩺", clat: "📖",
  govt_exam: "🏛️", govt_railway: "🚆", govt_banking: "🏦", govt_police: "👮",
  govt_judiciary: "⚖️", govt_ssc: "📝", govt_psc: "🏛️",
  nios: "🏫", up_board: "🗺️", bihar_board: "🗺️", rajasthan_board: "🗺️", mp_board: "🗺️",
  haryana_board: "🗺️", punjab_board: "🗺️", uttarakhand_board: "🗺️", himachal_board: "🗺️",
  jk_board: "🗺️", jharkhand_board: "🗺️", chhattisgarh_board: "🗺️",
  maharashtra_board: "🗺️", tn_board: "🗺️", kerala_board: "🗺️", wb_board: "🗺️",
  gujarat_board: "🗺️", karnataka_board: "🗺️", ap_board: "🗺️", telangana_board: "🗺️",
};

function subjectsFor(board: Board, cls: ClassLevel): string[] {
  if (board === "jee") return ["Physics", "Chemistry", "Mathematics"];
  if (board === "neet") return ["Physics", "Chemistry", "Biology"];
  if (board === "clat") {
    return [
      "Legal Reasoning",
      "English & Comprehension",
      "General Knowledge & Current Affairs",
      "Logical Reasoning",
      "Quantitative Techniques",
    ];
  }
  if (board === "govt_railway") {
    return ["General Awareness", "Mathematics", "General Intelligence & Reasoning", "General Science"];
  }
  if (board === "govt_banking") {
    return ["Quantitative Aptitude", "Reasoning Ability", "English Language", "Banking & General Awareness", "Computer Knowledge"];
  }
  if (board === "govt_police") {
    return ["General Knowledge & Current Affairs", "Reasoning", "Numerical Ability", "General English/Hindi"];
  }
  if (board === "govt_judiciary") {
    return ["Constitutional Law", "CPC", "CrPC", "IPC / BNS", "Evidence Act", "Contract Law", "Current Legal Affairs"];
  }
  if (board === "govt_ssc") {
    return ["General Awareness", "Quantitative Aptitude", "English Language", "General Intelligence & Reasoning"];
  }
  if (board === "govt_psc") {
    return ["General Studies", "Current Affairs", "Reasoning & Aptitude"];
  }
  if (board === "govt_exam") {
    return ["General Knowledge & Current Affairs", "Quantitative Aptitude", "Reasoning", "English Language"];
  }
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

  const allProfiles = profiles ?? [];

  useEffect(() => {
    if (allProfiles.length > 0 && !activeId) {
      setActiveId(allProfiles[0].id);
    }
  }, [allProfiles, activeId]);

  const active = allProfiles.find((p) => p.id === activeId) ?? null;

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

  const activeIsGovt = active ? isGovtBoard(active.board) : false;
  const headerName = active?.name ?? "Study Buddy";
  const headerSub = active
    ? `${BOARD_UPPER[active.board]} · ${active.class_level === "ug" ? "UG" : active.class_level === "pg" ? "PG" : active.class_level === "drop" ? "Drop year" : active.class_level === "aspirant" ? "Aspirant" : `Class ${active.class_level}`}`
    : null;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-card/40 px-5 pt-12 pb-3 backdrop-blur">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className={`grid h-9 w-9 place-items-center rounded-xl text-white ${activeIsGovt ? "bg-gradient-to-br from-amber-500 to-yellow-600" : "bg-gradient-to-br from-orange-400 to-pink-500"}`}>
          <span className="text-base">{activeIsGovt ? "🏛️" : "📚"}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-semibold truncate">{headerName}</div>
          {headerSub && <div className="text-[10px] text-muted-foreground">{headerSub}</div>}
        </div>
        <button
          onClick={() => setShowProgress(true)}
          aria-label="Progress"
          className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card"
        >
          <BarChart3 className="h-4 w-4" />
        </button>
      </header>

      {/* Unified profile chips: every learner_profiles row is a chip. Govt-family gets amber accent + emoji badge. */}
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-2 no-scrollbar">
        {allProfiles.map((p) => {
          const govt = isGovtBoard(p.board);
          const isActive = p.id === activeId;
          const base = "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition inline-flex items-center gap-1";
          const cls = govt
            ? (isActive
                ? `${base} border-amber-500/60 bg-amber-500/20 text-amber-300`
                : `${base} border-amber-500/30 bg-amber-500/10 text-amber-200/80`)
            : (isActive
                ? `${base} border-primary/40 bg-primary/15 text-primary`
                : `${base} border-border bg-card text-muted-foreground`);
          return (
            <button key={p.id} onClick={() => setActiveId(p.id)} className={cls}>
              {govt && <span aria-hidden>{BOARD_EMOJI[p.board] || "🏛️"}</span>}
              <span>{p.name}</span>
            </button>
          );
        })}
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



function BoardPicker({
  board,
  onChange,
}: {
  board: Board;
  onChange: (b: Board) => void;
}) {
  const [showGovt, setShowGovt] = useState<boolean>(isGovtBoard(board));
  const [showState, setShowState] = useState<boolean>(isStateBoard(board));
  const govtActive = isGovtBoard(board);
  const stateActive = isStateBoard(board);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {SCHOOL_BOARDS.map((b) => (
          <button
            type="button"
            key={b.value}
            onClick={() => { setShowGovt(false); setShowState(false); onChange(b.value); }}
            className={`rounded-xl border px-3 py-2 text-sm transition ${
              board === b.value ? "border-primary bg-primary/15 text-primary" : "border-border bg-card"
            }`}
          >
            {b.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { setShowState(false); setShowGovt((v) => !v || !govtActive); }}
          className={`col-span-2 rounded-xl border px-3 py-2 text-sm transition ${
            govtActive ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : "border-amber-500/30 bg-amber-500/5 text-amber-200/90"
          }`}
        >
          Govt / Competitive Exams 🏛️
        </button>
        <button
          type="button"
          onClick={() => { setShowGovt(false); setShowState((v) => !v || !stateActive); }}
          className={`col-span-2 rounded-xl border px-3 py-2 text-sm transition ${
            stateActive ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-200/90"
          }`}
        >
          State Boards 🗺️
        </button>
      </div>
      {(showGovt || govtActive) && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2">
          {GOVT_TRACKS.map((b) => (
            <button
              type="button"
              key={b.value}
              onClick={() => onChange(b.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                board === b.value ? "border-amber-500/70 bg-amber-500/25 text-amber-200" : "border-amber-500/20 bg-card text-muted-foreground"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {(showState || stateActive) && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-2">
          {STATE_BOARDS.map((b) => (
            <button
              type="button"
              key={b.value}
              onClick={() => onChange(b.value)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                board === b.value ? "border-emerald-500/70 bg-emerald-500/25 text-emerald-200" : "border-emerald-500/20 bg-card text-muted-foreground"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
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
      <div className="mt-1">
        <BoardPicker
          board={board}
          onChange={(b) => {
            setBoard(b);
            const opts = classLevelsFor(b);
            if (!opts.some((o) => o.value === classLevel)) setClassLevel(opts[0].value);
          }}
        />
      </div>


      <label className="mt-4 block text-xs font-medium text-muted-foreground">Class</label>
      <select
        value={classLevel}
        onChange={(e) => setClassLevel(e.target.value as ClassLevel)}
        className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none"
      >
        {classLevelsFor(board).map((c) => (
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
      <div className="mt-1">
        <BoardPicker
          board={board}
          onChange={(b) => {
            setBoard(b);
            const opts = classLevelsFor(b);
            if (!opts.some((o) => o.value === classLevel)) setClassLevel(opts[0].value);
          }}
        />
      </div>


      <label className="mt-4 block text-xs font-medium text-muted-foreground">Class</label>
      <select
        value={classLevel}
        onChange={(e) => setClassLevel(e.target.value as ClassLevel)}
        className="mt-1 w-full rounded-xl border border-border bg-input/50 px-3 py-2.5 text-sm focus:outline-none"
      >
        {classLevelsFor(board).map((c) => (
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
  const [quizSubject, setQuizSubject] = useState<{ subject: string; chapter?: string } | null>(null);
  const [paperSpec, setPaperSpec] = useState<{ subject: string; totalMarks: 30 | 80 | 100; chapter?: string } | null>(null);
  const [mockSpec, setMockSpec] = useState<{ durationMinutes: 30 | 60 | 90 } | null>(null);
  const [showQuizPicker, setShowQuizPicker] = useState(false);
  const [pickerSubject, setPickerSubject] = useState<string | null>(null);
  const [pickerChapter, setPickerChapter] = useState<string | "__all__" | null>(null);
  const [pickerMode, setPickerMode] = useState<"root" | "mock">("root");
  const [subjectSheet, setSubjectSheet] = useState<string | null>(null);
  const [tutorScope, setTutorScope] = useState<{ subject: string; chapter?: string } | null>(null);
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
    setTutorScope(null);
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
      if (tutorScope?.chapter) body.chapter = tutorScope.chapter;
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
            <h2 className="mt-4 font-display text-2xl font-bold text-white" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.85)" }}>Hi {profile.name} 👋</h2>
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
          {/* Tutor-scope chip — visible when a chapter (or whole subject) is
              scoping this chat. Explicit so the student knows the tutor is
              focused, and one-tap to clear. */}
          {tutorScope && (
            <div className="mb-2 flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                <span>🎯</span>
                <span className="max-w-[220px] truncate">
                  {tutorScope.subject}
                  {tutorScope.chapter ? ` · ${tutorScope.chapter}` : " · whole subject"}
                </span>
                <button
                  type="button"
                  onClick={() => setTutorScope(null)}
                  aria-label="Clear tutor scope"
                  className="grid h-4 w-4 place-items-center rounded-full hover:bg-primary/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
          {/* Subject chips + practice quiz. Tapping a subject opens a
              SubjectSheet with its chapter list — first-class, not buried in
              the practice picker. */}
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
                onClick={() => setSubjectSheet(s)}
                className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              >
                {s} 📚
              </button>
            ))}
          </div>
          {subjectSheet && createPortal(
            <SubjectSheet
              profile={profile}
              subject={subjectSheet}
              tutorScope={tutorScope}
              onClose={() => setSubjectSheet(null)}
              onScopeTutor={(subject, chapter) => {
                setTutorScope({ subject, chapter });
                setSubjectSheet(null);
                toast.success(chapter ? `tutor scoped to “${chapter}” 🎯` : `tutor scoped to whole ${subject} 🎯`);
              }}
              onStartQuiz={(subject, chapter) => {
                setQuizSubject({ subject, chapter });
                setSubjectSheet(null);
              }}
              onStartPaper={(subject, chapter, totalMarks) => {
                setPaperSpec({ subject, totalMarks, chapter });
                setSubjectSheet(null);
              }}
            />,
            document.body,
          )}
          {showQuizPicker && createPortal(
            <ModalCard
              onClose={() => {
                setShowQuizPicker(false);
                setPickerSubject(null);
                setPickerChapter(null);
                setPickerMode("root");
              }}
            >
              <div className="rounded-3xl border border-border bg-card p-6 shadow-2xl">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">practice</div>
                    <div className="font-display text-lg font-bold">
                      {pickerMode === "mock"
                        ? "pick a duration 🕐"
                        : pickerSubject && pickerChapter
                        ? "pick a format 📝"
                        : pickerSubject
                        ? "pick a chapter 📚"
                        : "pick a subject 📝"}
                    </div>
                    {pickerSubject && pickerMode === "root" && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{pickerSubject}</div>
                    )}
                    {pickerMode === "mock" && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        all subjects · MCQ only · auto-submit at 0
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setShowQuizPicker(false);
                      setPickerSubject(null);
                      setPickerChapter(null);
                      setPickerMode("root");
                    }}
                    aria-label="Close"
                    className="grid h-8 w-8 place-items-center rounded-full border border-border"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {pickerMode === "mock" ? (
                  <div className="mt-4 space-y-2">
                    {([30, 60, 90] as const).map((m) => {
                      const totalQ = m === 30 ? 50 : m === 60 ? 100 : 150;
                      return (
                        <button
                          key={m}
                          onClick={() => {
                            setShowQuizPicker(false);
                            setMockSpec({ durationMinutes: m });
                            setPickerMode("root");
                          }}
                          className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left hover:bg-amber-500/15"
                        >
                          <div className="text-sm font-semibold text-amber-200">🕐 {m} min mock</div>
                          <div className="text-[11px] text-muted-foreground">
                            {totalQ} MCQs · timed, auto-submits at 0
                          </div>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setPickerMode("root")}
                      className="w-full rounded-xl border border-border py-2 text-[11px] text-muted-foreground"
                    >
                      ← back
                    </button>
                  </div>
                ) : !pickerSubject ? (
                  <div className="mt-4">
                    {isGovtBoard(profile.board) && (
                      <button
                        onClick={() => setPickerMode("mock")}
                        className="mb-3 w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-left hover:bg-amber-500/15"
                      >
                        <div className="text-sm font-semibold text-amber-200">🕐 mock test — mixed & timed</div>
                        <div className="text-[11px] text-muted-foreground">
                          all subjects, MCQ-only, real timer with auto-submit
                        </div>
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
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
                  </div>
                ) : !pickerChapter ? (
                  <ChapterPickerPanel
                    profile={profile}
                    subject={pickerSubject}
                    onPick={(c) => setPickerChapter(c)}
                    onBack={() => setPickerSubject(null)}
                  />
                ) : (
                  <div className="mt-4 space-y-2">
                    <div className="mb-1 text-[11px] text-muted-foreground">
                      {pickerChapter === "__all__" ? "whole subject" : `chapter: ${pickerChapter}`}
                    </div>
                    <button
                      onClick={() => {
                        const ch = pickerChapter === "__all__" ? undefined : pickerChapter;
                        setShowQuizPicker(false);
                        setQuizSubject({ subject: pickerSubject, chapter: ch });
                        setPickerSubject(null);
                        setPickerChapter(null);
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
                          const ch = pickerChapter === "__all__" ? undefined : pickerChapter;
                          setShowQuizPicker(false);
                          setPaperSpec({ subject: pickerSubject, totalMarks: m, chapter: ch });
                          setPickerSubject(null);
                          setPickerChapter(null);
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
                      onClick={() => setPickerChapter(null)}
                      className="w-full rounded-xl border border-border py-2 text-[11px] text-muted-foreground"
                    >
                      ← change chapter
                    </button>
                  </div>
                )}
              </div>
            </ModalCard>,
            document.body,
          )}
          {quizSubject && (
            <QuizModal
              profile={profile}
              initialSubject={quizSubject.subject}
              chapter={quizSubject.chapter}
              onClose={() => setQuizSubject(null)}
            />
          )}
          {paperSpec && (
            <PaperModal
              profile={profile}
              subject={paperSpec.subject}
              totalMarks={paperSpec.totalMarks}
              chapter={paperSpec.chapter}
              onClose={() => setPaperSpec(null)}
            />
          )}
          {mockSpec && (
            <MockPaperModal
              profile={profile}
              subjects={subjects}
              durationMinutes={mockSpec.durationMinutes}
              onClose={() => setMockSpec(null)}
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

// ------------------------- Chapter picker -------------------------

type ChapterRow = { chapter_number: number; chapter_title: string };

function ChapterPickerPanel({
  profile,
  subject,
  onPick,
  onBack,
}: {
  profile: LearnerProfile;
  subject: string;
  onPick: (chapter: string | "__all__") => void;
  onBack: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: attempts } = useAttempts();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Flat body — the study-chapters function reads board/classLevel/subject
        // at the top level. Sending them nested under `profile` silently
        // resolved to `board=""`, tripping the "invalid board" guard and
        // returning an empty chapter list every time.
        const { data, error } = await supabase.functions.invoke("study-chapters", {
          body: {
            board: profile.board,
            classLevel: profile.class_level,
            subject,
          },
        });
        if (cancelled) return;
        if (error) throw error;
        const d = data as { chapters?: ChapterRow[] };
        setChapters(Array.isArray(d?.chapters) ? d.chapters : []);
      } catch {
        if (!cancelled) setChapters([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.board, profile.class_level, subject]);

  // Private mastery per chapter — %score across this profile's attempts for
  // (subject, chapter). Uses attemptScore semantics.
  const mastery = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const a of attempts ?? []) {
    if (a.profile_id !== profile.id) continue;
    if (a.subject !== subject) continue;
    const key = a.chapter ?? "";
    if (!key) continue;
    const num = a.total_marks && a.total_marks > 0
      ? Math.max(0, a.marks_scored ?? 0)
      : Math.max(0, a.correct_count ?? 0);
    const den = a.total_marks && a.total_marks > 0
      ? a.total_marks
      : (a.total_questions ?? 0);
    if (den <= 0) continue;
    const pct = Math.round((num / den) * 100);
    mastery.set(key, (mastery.get(key) ?? 0) + pct);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const avgMastery = (title: string) => {
    const c = counts.get(title);
    if (!c) return null;
    return Math.round((mastery.get(title) ?? 0) / c);
  };

  return (
    <div className="mt-4 space-y-2 max-h-[50vh] overflow-y-auto">
      <div className="mb-1 text-[11px] text-muted-foreground">{subject} · pick a chapter</div>
      <button
        onClick={() => onPick("__all__")}
        className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted"
      >
        <div className="font-semibold">🎯 whole subject</div>
        <div className="text-[11px] text-muted-foreground">mixed questions from any chapter</div>
      </button>
      {loading && (
        <div className="py-4 text-center text-xs text-muted-foreground">loading chapters…</div>
      )}
      {!loading && chapters && chapters.length === 0 && (
        <div className="py-2 text-center text-[11px] text-muted-foreground">
          no chapter list available — use whole subject
        </div>
      )}
      {!loading && chapters && chapters.map((c) => {
        const pct = avgMastery(c.chapter_title);
        const badge = pct === null ? null
          : pct >= 75 ? { label: `${pct}% 🟢`, tone: "text-emerald-400" }
          : pct >= 50 ? { label: `${pct}% 🟡`, tone: "text-amber-400" }
          : { label: `${pct}% 🔴`, tone: "text-rose-400" };
        return (
          <button
            key={c.chapter_number}
            onClick={() => onPick(c.chapter_title)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  ch {c.chapter_number}
                </div>
                <div className="truncate font-medium">{c.chapter_title}</div>
              </div>
              {badge && (
                <div className={`shrink-0 text-[11px] font-semibold ${badge.tone}`}>{badge.label}</div>
              )}
            </div>
          </button>
        );
      })}
      <button
        onClick={onBack}
        className="w-full rounded-xl border border-border py-2 text-[11px] text-muted-foreground"
      >
        ← change subject
      </button>
    </div>
  );
}

// ------------------------- Subject sheet -------------------------
// First-class chapter view: tapping any subject chip opens this sheet with
// the real chapter TOC (via study-chapters, same fixed flat body). Each
// chapter offers tutor / quiz / paper actions and shows the private mastery
// badge. Fetch is per-open (useEffect keyed on subject), no react-query cache
// — a previous session's "unavailable" cannot linger.

function SubjectSheet({
  profile,
  subject,
  tutorScope,
  onScopeTutor,
  onStartQuiz,
  onStartPaper,
  onClose,
}: {
  profile: LearnerProfile;
  subject: string;
  tutorScope: { subject: string; chapter?: string } | null;
  onScopeTutor: (subject: string, chapter?: string) => void;
  onStartQuiz: (subject: string, chapter?: string) => void;
  onStartPaper: (subject: string, chapter: string | undefined, totalMarks: 30 | 80 | 100) => void;
  onClose: () => void;
}) {
  const [chapters, setChapters] = useState<ChapterRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [paperFor, setPaperFor] = useState<{ chapter?: string } | null>(null);
  const { data: attempts } = useAttempts();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setChapters(null);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("study-chapters", {
          body: {
            board: profile.board,
            classLevel: profile.class_level,
            subject,
          },
        });
        if (cancelled) return;
        if (error) throw error;
        const d = data as { chapters?: ChapterRow[] };
        setChapters(Array.isArray(d?.chapters) ? d.chapters : []);
      } catch {
        if (!cancelled) setChapters([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profile.board, profile.class_level, subject]);

  // Mastery per chapter — %score across this profile's attempts for
  // (subject, chapter). Keyed by chapter_title, matching how attempts store it.
  const mastery = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const a of attempts ?? []) {
    if (a.profile_id !== profile.id) continue;
    if (a.subject !== subject) continue;
    const key = a.chapter ?? "";
    if (!key) continue;
    const num = a.total_marks && a.total_marks > 0
      ? Math.max(0, a.marks_scored ?? 0)
      : Math.max(0, a.correct_count ?? 0);
    const den = a.total_marks && a.total_marks > 0
      ? a.total_marks
      : (a.total_questions ?? 0);
    if (den <= 0) continue;
    const pct = Math.round((num / den) * 100);
    mastery.set(key, (mastery.get(key) ?? 0) + pct);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const avgMastery = (title: string) => {
    const c = counts.get(title);
    if (!c) return null;
    return Math.round((mastery.get(title) ?? 0) / c);
  };
  const badgeFor = (pct: number | null) =>
    pct === null ? null
    : pct >= 75 ? { label: `${pct}% 🟢`, tone: "text-emerald-400" }
    : pct >= 50 ? { label: `${pct}% 🟡`, tone: "text-amber-400" }
    : { label: `${pct}% 🔴`, tone: "text-rose-400" };

  const scopedChapter =
    tutorScope && tutorScope.subject === subject
      ? (tutorScope.chapter ?? "__all__")
      : null;

  return (
    <ModalCard onClose={onClose}>
      <div className="rounded-3xl border border-border bg-card p-5 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {profile.name} · {subject}
            </div>
            <div className="font-display text-lg font-bold">chapters 📚</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full border border-border"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {paperFor && (
          <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="mb-2 text-[11px] text-muted-foreground">
              {paperFor.chapter ? `paper · ${paperFor.chapter}` : "paper · whole subject"}
            </div>
            <div className="flex gap-2">
              {([30, 80, 100] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    const ch = paperFor.chapter;
                    setPaperFor(null);
                    onStartPaper(subject, ch, m);
                  }}
                  className="flex-1 rounded-xl border border-border bg-card px-2 py-2 text-xs font-semibold hover:bg-muted"
                >
                  {m} marks
                </button>
              ))}
            </div>
            <button
              onClick={() => setPaperFor(null)}
              className="mt-2 w-full text-[10px] text-muted-foreground"
            >
              cancel
            </button>
          </div>
        )}

        {/* Whole-subject option — kept as first-class alongside chapters. */}
        <div className="mt-3 rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">🎯 whole subject</div>
              <div className="text-[10px] text-muted-foreground">mixed content across every chapter</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <SheetActionBtn
                label="💬"
                title="chat"
                active={scopedChapter === "__all__"}
                onClick={() => onScopeTutor(subject, undefined)}
              />
              <SheetActionBtn
                label="📝"
                title="quick quiz"
                onClick={() => onStartQuiz(subject, undefined)}
              />
              <SheetActionBtn
                label="📄"
                title="full paper"
                onClick={() => setPaperFor({ chapter: undefined })}
              />
            </div>
          </div>
        </div>

        <div className="mt-2 space-y-1.5">
          {loading && (
            <div className="py-4 text-center text-xs text-muted-foreground">loading chapters…</div>
          )}
          {!loading && chapters && chapters.length === 0 && (
            <div className="py-2 text-center text-[11px] text-muted-foreground">
              no chapter list available — use whole subject above
            </div>
          )}
          {!loading && chapters && chapters.map((c) => {
            const b = badgeFor(avgMastery(c.chapter_title));
            const isScoped = scopedChapter === c.chapter_title;
            return (
              <div key={c.chapter_number} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      ch {c.chapter_number}
                    </div>
                    <div className="truncate text-sm font-medium">{c.chapter_title}</div>
                    {b && (
                      <div className={`mt-0.5 text-[10px] font-semibold ${b.tone}`}>{b.label}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <SheetActionBtn
                      label="💬"
                      title="chat"
                      active={isScoped}
                      onClick={() => onScopeTutor(subject, c.chapter_title)}
                    />
                    <SheetActionBtn
                      label="📝"
                      title="quick quiz"
                      onClick={() => onStartQuiz(subject, c.chapter_title)}
                    />
                    <SheetActionBtn
                      label="📄"
                      title="full paper"
                      onClick={() => setPaperFor({ chapter: c.chapter_title })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ModalCard>
  );
}

function SheetActionBtn({
  label, title, onClick, active,
}: { label: string; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-full border text-sm ${
        active ? "border-primary/60 bg-primary/20" : "border-border bg-muted/40 hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

// ------------------------- Quiz -------------------------




type QuizQ = { question: string; options: string[]; correct_index: number; explanation: string };

function QuizModal({
  profile,
  initialSubject,
  chapter,
  onClose,
}: {
  profile: LearnerProfile;
  initialSubject: string;
  chapter?: string;
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
            chapter: chapter ?? undefined,
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
        chapter: chapter ?? null,
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

const QUIZ_ATTEMPTS_KEY = ["quiz-attempts"] as const;

function timeHintFor(total: 30 | 80 | 100): string {
  if (total === 30) return "~45 min";
  if (total === 80) return "~2 hr 30 min";
  return "~3 hr";
}

function sectionForType(t: "mcq" | "short" | "long"): { key: "A" | "B" | "C"; label: string } {
  if (t === "mcq") return { key: "A", label: "SECTION A — Multiple Choice" };
  if (t === "short") return { key: "B", label: "SECTION B — Short Answer" };
  return { key: "C", label: "SECTION C — Long Answer" };
}

type PaperDraft =
  | { kind: "mcq"; pick: number }
  | { kind: "text"; value: string }
  | { kind: "photo"; mime: string; data: string; previewUrl: string };

type PaperGradeEntry = {
  awarded: number;
  max: number;
  feedback: string;
  transcript?: string;
  correct_index?: number;
  usedPhoto?: boolean;
};

async function gradePool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>, onProgress: () => void): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch {
        // caller normalizes; store a zero-shaped result via worker itself
      }
      onProgress();
    }
  });
  await Promise.all(runners);
  return results;
}

function PaperModal({
  profile,
  subject,
  totalMarks,
  chapter,
  onClose,
}: {
  profile: LearnerProfile;
  subject: string;
  totalMarks: 30 | 80 | 100;
  chapter?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PaperQClient[] | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, PaperDraft>>({});
  const [reattachIds, setReattachIds] = useState<Set<string>>(new Set());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [phase, setPhase] = useState<"answering" | "grading" | "done">("answering");
  const [confirm, setConfirm] = useState<null | "submit" | "close">(null);
  const [gradedCount, setGradedCount] = useState(0);
  const [results, setResults] = useState<Record<string, PaperGradeEntry>>({});
  const [totalScored, setTotalScored] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const finishedRef = useRef(false);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [savedTick, setSavedTick] = useState(0);
  const [resumeOffer, setResumeOffer] = useState<
    | null
    | {
        paperId: string;
        totalMarks: number;
        answered: number;
        total: number;
        questions: PaperQClient[];
        drafts: Record<string, PaperDraft>;
        reattach: Set<string>;
        updatedAt: string;
      }
  >(null);
  const [downloadSheet, setDownloadSheet] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const host = document.createElement("div");
    host.setAttribute("data-paper-modal-host", "true");
    Object.assign(host.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      width: "100vw",
      height: "100dvh",
      zIndex: "999",
      overflow: "hidden",
    });
    document.documentElement.appendChild(host);
    setPortalHost(host);
    return () => {
      host.remove();
      setPortalHost(null);
    };
  }, []);

  const generateFresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("study-paper-generate", {
        body: {
          profile: { board: profile.board, classLevel: profile.class_level },
          profileId: profile.id,
          subject,
          totalMarks,
          chapter: chapter ?? undefined,
        },
      });
      if (error) throw error;
      const d = data as { source?: string; paper_id?: string; questions?: PaperQClient[]; reason?: string };
      if (d?.source === "paper" && d.paper_id && Array.isArray(d.questions) && d.questions.length > 0) {
        setPaperId(d.paper_id);
        setQuestions(d.questions);
        setDrafts({});
        setReattachIds(new Set());
        setCurrentIdx(0);
      } else {
        setErrorMsg("couldn't build that paper — try again 🌿");
      }
    } catch {
      setErrorMsg("couldn't build that paper — try again 🌿");
    } finally {
      setLoading(false);
    }
  }, [profile.id, profile.board, profile.class_level, subject, totalMarks]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      // Try resume first: same-subject, same-total-marks, in_progress row.
      try {
        const { data: res } = await supabase.functions.invoke("study-paper-resume", {
          body: { profile_id: profile.id, subject },
        });
        if (cancelled) return;
        const r = res as {
          found?: boolean;
          paper_id?: string;
          total_marks?: number;
          questions?: PaperQClient[];
          draft_answers?: Record<string, unknown>;
          updated_at?: string;
        };
        if (
          r?.found &&
          r.paper_id &&
          Array.isArray(r.questions) &&
          r.questions.length > 0 &&
          r.total_marks === totalMarks
        ) {
          // Hydrate saved drafts. Text drafts fill in; photo drafts flag for reattach.
          const map: Record<string, PaperDraft> = {};
          const reattach = new Set<string>();
          for (const [qid, d] of Object.entries(r.draft_answers ?? {})) {
            const dd = d as { kind?: string; value?: unknown };
            if (dd?.kind === "text" && typeof dd.value === "string" && dd.value.length > 0) {
              map[qid] = { kind: "text", value: dd.value };
            } else if (dd?.kind === "photo") {
              reattach.add(qid);
            }
          }
          setResumeOffer({
            paperId: r.paper_id,
            totalMarks: r.total_marks,
            answered: Object.keys(map).length + reattach.size,
            total: r.questions.length,
            questions: r.questions,
            drafts: map,
            reattach,
            updatedAt: r.updated_at ?? "",
          });
          setLoading(false);
          return;
        }
      } catch { /* resume is best-effort; fall through to generate */ }
      if (!cancelled) await generateFresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, subject, totalMarks]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      Object.values(drafts).forEach((d) => {
        if (d.kind === "photo") URL.revokeObjectURL(d.previewUrl);
      });
      Object.values(saveTimers.current).forEach((t) => clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = questions?.[currentIdx] ?? null;
  const totalQuestions = questions?.length ?? 0;

  function isAnswered(qid: string): boolean {
    const d = drafts[qid];
    if (!d) return false;
    if (d.kind === "mcq") return true;
    if (d.kind === "text") return d.value.trim().length > 0;
    if (d.kind === "photo") return d.data.length > 0;
    return false;
  }

  const answeredCount = questions ? questions.filter((qq) => isAnswered(qq.id)).length : 0;

  // Debounced autosave (~800ms). Best-effort, silent on failure. Only text
  // drafts persist their content; photo drafts persist a marker (bytes stay
  // local until submit).
  function scheduleSave(qid: string, next: PaperDraft | null) {
    if (!paperId) return;
    if (saveTimers.current[qid]) clearTimeout(saveTimers.current[qid]);
    saveTimers.current[qid] = setTimeout(async () => {
      let payload: null | { kind: "text"; value: string } | { kind: "photo"; attached: true } = null;
      if (next && next.kind === "text") payload = { kind: "text", value: next.value };
      else if (next && next.kind === "photo") payload = { kind: "photo", attached: true };
      // MCQ picks and empty drafts don't persist per spec.
      if (next && next.kind === "mcq") return;
      try {
        await supabase.functions.invoke("study-paper-save-draft", {
          body: { paper_id: paperId, question_id: qid, draft: payload },
        });
        setSavedTick((n) => n + 1);
      } catch { /* silent */ }
    }, 800);
  }

  function setDraft(qid: string, next: PaperDraft | null) {
    setDrafts((prev) => {
      const copy = { ...prev };
      const existing = copy[qid];
      if (existing && existing.kind === "photo" && (!next || next.kind !== "photo" || next.data !== existing.data)) {
        URL.revokeObjectURL(existing.previewUrl);
      }
      if (!next) delete copy[qid];
      else copy[qid] = next;
      return copy;
    });
    // Once the student attaches or edits a real answer, the "reattach"
    // marker for that question is cleared.
    if (next) {
      setReattachIds((prev) => {
        if (!prev.has(qid)) return prev;
        const nx = new Set(prev);
        nx.delete(qid);
        return nx;
      });
    }
    scheduleSave(qid, next);
  }

  async function handlePhotoPick(qid: string, e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast.error("please pick an image");
    if (f.size > 10 * 1024 * 1024) return toast.error("image must be under 10MB");
    try {
      const { base64, dataUrl } = await compressToJpeg(f, 1600, 0.85);
      setDraft(qid, { kind: "photo", mime: "image/jpeg", data: base64, previewUrl: dataUrl });
    } catch {
      toast.error("couldn't read that photo");
    }
  }

  function acceptResume() {
    if (!resumeOffer) return;
    setPaperId(resumeOffer.paperId);
    setQuestions(resumeOffer.questions);
    setDrafts(resumeOffer.drafts);
    setReattachIds(resumeOffer.reattach);
    setCurrentIdx(0);
    setResumeOffer(null);
    setLoading(false);
  }

  async function declineResume() {
    if (!resumeOffer) return;
    // Best-effort abandon of the old row so future resume checks skip it.
    try {
      await supabase.functions.invoke("study-paper-finish", {
        body: { paper_id: resumeOffer.paperId, action: "abandon" },
      });
    } catch { /* best-effort */ }
    setResumeOffer(null);
    await generateFresh();
  }



  async function runBatchGrading() {
    if (!questions || !paperId || phase === "grading") return;
    setPhase("grading");
    setGradedCount(0);
    setResults({});

    const gradable = questions.filter((qq) => isAnswered(qq.id));
    const perQ: Record<string, PaperGradeEntry> = {};

    // Unanswered → zero locally.
    for (const qq of questions) {
      if (!isAnswered(qq.id)) {
        perQ[qq.id] = { awarded: 0, max: qq.marks, feedback: "no answer submitted." };
      }
    }

    await gradePool(gradable, 3, async (qq) => {
      const draft = drafts[qq.id];
      const requestBody: Record<string, unknown> = { paper_id: paperId, question_id: qq.id };
      let usedPhoto = false;
      if (qq.type === "mcq") {
        requestBody.answer = draft && draft.kind === "mcq" ? draft.pick : -1;
      } else if (draft && draft.kind === "photo") {
        requestBody.answer_image = { mime: draft.mime, data: draft.data };
        usedPhoto = true;
      } else if (draft && draft.kind === "text") {
        requestBody.answer = draft.value.trim();
      } else {
        requestBody.answer = "";
      }
      try {
        const { data, error } = await supabase.functions.invoke("study-paper-grade", { body: requestBody });
        if (error) throw error;
        const d = data as GradeResult & { source?: string; reason?: string; transcript?: string };
        if (typeof d.awarded_marks !== "number") {
          perQ[qq.id] = { awarded: 0, max: qq.marks, feedback: "couldn't grade this one." };
        } else {
          perQ[qq.id] = {
            awarded: d.awarded_marks,
            max: d.max_marks ?? qq.marks,
            feedback: d.feedback ?? "",
            transcript: d.transcript,
            correct_index: d.correct_index,
            usedPhoto,
          };
        }
      } catch {
        perQ[qq.id] = { awarded: 0, max: qq.marks, feedback: "couldn't grade this one." };
      }
    }, () => setGradedCount((c) => c + 1));

    const sum = Object.values(perQ).reduce((acc, r) => acc + r.awarded, 0);
    setResults(perQ);
    setTotalScored(sum);

    // Persist.
    if (!finishedRef.current && paperId) {
      finishedRef.current = true;
      setFinishing(true);
      try {
        await supabase.functions.invoke("study-paper-finish", {
          body: { paper_id: paperId, marks_scored: sum, total_marks: totalMarks, subject, chapter: chapter ?? undefined },
        });
        qc.invalidateQueries({ queryKey: QUIZ_ATTEMPTS_KEY });
      } catch { /* best-effort */ }
      finally { setFinishing(false); }
    }

    setPhase("done");
  }

  function requestClose() {
    if (phase === "done") { onClose(); return; }
    if (phase === "grading") return; // block close during grading
    if (Object.keys(drafts).length === 0) { onClose(); return; }
    setConfirm("close");
  }

  const pct = totalMarks > 0 ? Math.round((totalScored / totalMarks) * 100) : 0;

  // Palette: group by section for the full grid.
  const paletteSections = questions
    ? (["mcq", "short", "long"] as const).map((t) => ({
        t,
        info: sectionForType(t),
        items: questions.map((qq, i) => ({ qq, i })).filter((x) => x.qq.type === t),
      })).filter((s) => s.items.length > 0)
    : [];

  // -------- Printable / downloadable paper --------
  function buildPaperHtml(): string {
    const qs = questions ?? [];
    const boardLbl = BOARD_UPPER[profile.board];
    const clsLbl =
      profile.class_level === "ug" ? "Undergraduate"
      : profile.class_level === "pg" ? "Postgraduate"
      : profile.class_level === "drop" ? "Drop year"
      : profile.class_level === "aspirant" ? "Aspirant"
      : `Class ${profile.class_level}`;
    const time = timeHintFor(totalMarks);
    const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const sections = (["mcq", "short", "long"] as const)
      .map((t) => ({ t, info: sectionForType(t), items: qs.filter((qq) => qq.type === t) }))
      .filter((s) => s.items.length > 0);
    let sectionsHtml = "";
    let counter = 0;
    for (const s of sections) {
      sectionsHtml += `<h2 class="section">${esc(s.info.label)}</h2>`;
      for (const qq of s.items) {
        counter++;
        sectionsHtml += `<div class="q"><div class="qhead"><span class="qn">Q${counter}.</span> <span class="qm">[${qq.marks} ${qq.marks === 1 ? "mark" : "marks"}]</span></div><div class="qbody">${esc(qq.question)}</div>`;
        if (qq.type === "mcq") {
          sectionsHtml += '<ol type="A" class="opts">';
          for (const opt of qq.options) sectionsHtml += `<li>${esc(opt)}</li>`;
          sectionsHtml += "</ol>";
        } else if (qq.type === "short") {
          sectionsHtml += '<div class="lines">' + '<div class="line"></div>'.repeat(4) + "</div>";
        } else {
          sectionsHtml += '<div class="lines">' + '<div class="line"></div>'.repeat(10) + "</div>";
        }
        sectionsHtml += "</div>";
      }
    }
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(subject)} — ${totalMarks} marks</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  html, body { background: #fff; color: #111; font-family: Georgia, "Times New Roman", serif; margin: 0; padding: 0; }
  .wrap { max-width: 780px; margin: 0 auto; padding: 24px; }
  header { text-align: center; border-bottom: 1px solid #999; padding-bottom: 10px; margin-bottom: 16px; }
  header .board { font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; font-weight: 700; }
  header .cls { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #555; margin-top: 2px; }
  header .meta { font-size: 12px; margin-top: 6px; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
  header .meta b { font-weight: 700; }
  h2.section { font-size: 12px; letter-spacing: 0.15em; text-transform: uppercase; text-align: center; margin: 18px 0 8px; border-top: 1px dashed #bbb; padding-top: 10px; font-weight: 700; }
  .q { margin: 10px 0 14px; page-break-inside: avoid; }
  .qhead { display: flex; justify-content: space-between; font-size: 12px; color: #444; }
  .qn { font-weight: 700; color: #111; }
  .qm { font-variant-numeric: tabular-nums; }
  .qbody { font-size: 14px; line-height: 1.5; margin-top: 3px; white-space: pre-wrap; }
  ol.opts { margin: 6px 0 0 22px; font-size: 13px; line-height: 1.7; }
  .lines { margin-top: 6px; }
  .line { height: 22px; border-bottom: 1px solid #bbb; }
  footer { margin-top: 20px; text-align: center; font-size: 10px; color: #888; }
  @media print { .noprint { display: none !important; } }
</style></head>
<body><div class="wrap">
  <header>
    <div class="board">${esc(boardLbl)}</div>
    <div class="cls">${esc(clsLbl)}</div>
    <div class="meta"><span><b>Subject:</b> ${esc(subject)}</span><span><b>Max Marks:</b> ${totalMarks}</span><span><b>Time:</b> ${esc(time)}</span></div>
  </header>
  ${sectionsHtml}
  <footer>— End of paper —</footer>
  <div class="noprint" style="margin-top:16px;text-align:center;">
    <button onclick="window.print()" style="padding:10px 18px;font-size:14px;border-radius:8px;border:1px solid #333;background:#111;color:#fff;cursor:pointer">🖨️ Print / Save as PDF</button>
  </div>
</div></body></html>`;
  }

  async function doPrintInApp() {
    const html = buildPaperHtml();
    // Try opening a new window (works reliably in desktop browsers).
    let w: Window | null = null;
    try { w = window.open("", "_blank"); } catch { w = null; }
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      setTimeout(() => { try { w!.focus(); w!.print(); } catch { /* ignore */ } }, 500);
      setDownloadSheet(false);
      return;
    }
    // Native WebView: render via hidden iframe and call print on that frame.
    // This is best-effort — some Android WebView builds silently ignore print.
    try {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      if (!doc) throw new Error("no doc");
      doc.open();
      doc.write(html);
      doc.close();
      setTimeout(() => {
        try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch { /* ignore */ }
        setTimeout(() => iframe.remove(), 60_000);
      }, 500);
      setDownloadSheet(false);
      toast.success("if nothing happened, try 'open in browser' below");
    } catch {
      toast.error("in-app print not available — try 'open in browser'");
    }
  }

  async function doOpenInBrowser() {
    const html = buildPaperHtml();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setDownloadSheet(false);
    // Prefer Capacitor Browser on native; fall back to window.open on web.
    try {
      const mod = await import(/* @vite-ignore */ "@capacitor/browser");
      await mod.Browser.open({ url, presentationStyle: "popover", toolbarColor: "#0E0F13" });
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    // Keep the objectURL alive for a while so the browser can load it.
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  }

  if (!portalHost) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background text-foreground"
      data-testid="paper-modal-overlay"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100dvh", zIndex: 999 }}
    >

      {/* ---- Sticky top bar ---- */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button onClick={requestClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">exam mode</div>
          <div className="truncate font-display text-sm font-bold">{subject} · {totalMarks} marks</div>
        </div>
        {phase === "answering" ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setDownloadSheet(true)}
              disabled={loading || !!errorMsg || !questions}
              aria-label="Download or print paper"
              title="Download / print"
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-muted-foreground disabled:opacity-50"
            >
              <span aria-hidden className="text-base leading-none">📄</span>
            </button>
            <button
              onClick={() => setConfirm("submit")}
              disabled={loading || !!errorMsg || !questions}
              className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              submit paper
            </button>
          </div>
        ) : (
          <div className="w-[92px]" />
        )}
      </div>

      {/* ---- Body ---- */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {loading && (
          <div className="mt-20 text-center text-sm text-muted-foreground">
            building your paper… 📄
          </div>
        )}

        {!loading && errorMsg && (
          <div className="mt-20 px-6 text-center">
            <div className="text-4xl">🌿</div>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
            <button onClick={onClose} className="mt-4 rounded-xl border border-border px-4 py-2 text-sm">close</button>
          </div>
        )}

        {!loading && !errorMsg && phase === "grading" && questions && (
          <div className="mt-24 px-6 text-center">
            <div className="text-4xl">📝</div>
            <div className="mt-3 font-display text-lg font-bold">grading your paper…</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {gradedCount}/{questions.filter((qq) => isAnswered(qq.id)).length} graded
            </div>
            <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${questions.length ? Math.min(100, (gradedCount / Math.max(1, questions.filter((qq) => isAnswered(qq.id)).length)) * 100) : 0}%` }}
              />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">hang tight — reading each answer carefully ✍️</p>
          </div>
        )}

        {!loading && !errorMsg && phase === "done" && questions && (
          <div className="mx-auto max-w-2xl px-4 pt-6">
            <div className="text-center">
              <div className="text-5xl">{pct >= 90 ? "🏆" : pct >= 60 ? "🎉" : "🌱"}</div>
              <div className="mt-2 font-display text-2xl font-bold">
                you scored {totalScored}/{totalMarks}!
              </div>
              <div className="text-xs text-muted-foreground">that's {pct}%</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {pct >= 90 ? "outstanding — you know this cold."
                  : pct >= 60 ? "solid work — real understanding showing through."
                  : "great practice — every attempt makes the next one easier 💪"}
              </p>
              {finishing && <div className="mt-2 text-[10px] text-muted-foreground">saving…</div>}
            </div>

            <div className="mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">review</div>
            <div className="mt-2 space-y-2 pb-6">
              {questions.map((qq, i) => {
                const r = results[qq.id];
                if (!r) return null;
                const full = r.awarded === r.max;
                const partial = r.awarded > 0 && !full;
                return (
                  <div
                    key={qq.id}
                    className={`rounded-xl border px-3 py-2.5 text-xs ${
                      full ? "border-green-500/30 bg-green-500/5"
                      : partial ? "border-yellow-500/30 bg-yellow-500/5"
                      : "border-border bg-muted/30"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">Q{i + 1} · {qq.type === "mcq" ? "MCQ" : qq.type === "short" ? "Short" : "Long"}</div>
                      <div className={`font-mono text-[11px] ${full ? "text-green-300" : partial ? "text-yellow-200" : "text-muted-foreground"}`}>
                        {r.awarded}/{r.max}
                      </div>
                    </div>
                    <div className="mt-1 line-clamp-2 text-muted-foreground">{qq.question}</div>
                    {r.usedPhoto && r.transcript && (
                      <div className="mt-2 rounded-lg border border-border bg-background/50 px-2 py-1.5">
                        <div className="text-[10px] font-medium text-muted-foreground">here's what we read from your photo:</div>
                        <div className="mt-0.5 whitespace-pre-wrap text-foreground/90">{r.transcript}</div>
                      </div>
                    )}
                    {r.feedback && <div className="mt-1.5 text-foreground/90">{r.feedback}</div>}
                  </div>
                );
              })}
            </div>

            <button
              onClick={onClose}
              disabled={finishing}
              className="mb-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              done
            </button>
          </div>
        )}

        {!loading && !errorMsg && phase === "answering" && questions && q && (
          <>
            {/* Palette strip */}
            <div className="sticky top-0 z-[5] border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
              <div className="flex items-center gap-2">
                <div className="flex-1 overflow-x-auto">
                  <div className="flex items-center gap-1.5">
                    {questions.map((qq, i) => {
                      const answered = isAnswered(qq.id);
                      const current = i === currentIdx;
                      return (
                        <button
                          key={qq.id}
                          onClick={() => setCurrentIdx(i)}
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold transition ${
                            current
                              ? "border-primary bg-primary text-primary-foreground"
                              : answered
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                          aria-label={`Question ${i + 1}${answered ? " (answered)" : ""}`}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground"
                  aria-label="View all questions"
                >
                  ⊞ all
                </button>
              </div>
              <div className="mt-1.5 text-center text-[10px] text-muted-foreground">
                {answeredCount}/{totalQuestions} answered {savedTick > 0 && <span className="ml-1 text-primary/70">· saved ✓</span>}
              </div>
            </div>

            <div className="mx-auto max-w-2xl px-4 pt-4">
              {/* -------- The "paper" surface -------- */}
              <div
                className="rounded-2xl border border-stone-300 p-5 font-serif text-stone-900 shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
                style={{ background: "#f7f1e3" }}
              >
                <div className="text-center">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-700">
                    {BOARD_UPPER[profile.board]}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-stone-600">
                    {profile.class_level === "ug" ? "Undergraduate"
                      : profile.class_level === "pg" ? "Postgraduate"
                      : profile.class_level === "drop" ? "Drop year"
                      : profile.class_level === "aspirant" ? "Aspirant"
                      : `Class ${profile.class_level}`}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[11px] text-stone-800">
                    <span><span className="font-semibold">Subject:</span> {subject}</span>
                    <span><span className="font-semibold">Max Marks:</span> {totalMarks}</span>
                    <span><span className="font-semibold">Time:</span> {timeHintFor(totalMarks)}</span>
                  </div>
                </div>
                <div className="my-3 border-t border-stone-400/60" />

                <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-stone-700">
                  {sectionForType(q.type).label}
                </div>

                <div className="flex items-baseline justify-between gap-3 text-[11px] text-stone-600">
                  <span>Question {currentIdx + 1} of {totalQuestions}</span>
                  <span>[{q.marks} {q.marks === 1 ? "mark" : "marks"}]</span>
                </div>

                <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">
                  <span className="font-semibold">Q{currentIdx + 1}. </span>{q.question}
                </div>
              </div>

              {/* -------- Answer draft area -------- */}
              <PaperAnswerArea
                q={q}
                draft={drafts[q.id]}
                onDraft={(next) => setDraft(q.id, next)}
                onPhotoPick={(e) => handlePhotoPick(q.id, e)}
                photoInputRef={photoInputRef}
                needsReattach={reattachIds.has(q.id)}
              />

              {/* -------- Prev / Next -------- */}
              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                  disabled={currentIdx === 0}
                  className="flex-1 rounded-xl border border-border py-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  ← prev
                </button>
                <button
                  onClick={() => setCurrentIdx(Math.min(totalQuestions - 1, currentIdx + 1))}
                  disabled={currentIdx >= totalQuestions - 1}
                  className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  next →
                </button>
              </div>
              <div className="pb-6" />
            </div>
          </>
        )}
      </div>

      {/* ---- Palette full-grid overlay ---- */}
      {paletteOpen && questions && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background/95 backdrop-blur">
          <div
            className="flex items-center justify-between border-b border-border px-4 py-3"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="font-display text-sm font-bold">all questions</div>
            <button onClick={() => setPaletteOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-border">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-primary/40 bg-primary/15" /> answered</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-border bg-card" /> unanswered</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded border border-primary bg-primary" /> current</span>
            </div>
            {paletteSections.map((sec) => (
              <div key={sec.t} className="mb-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {sec.info.label}
                </div>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                  {sec.items.map(({ qq, i }) => {
                    const answered = isAnswered(qq.id);
                    const current = i === currentIdx;
                    return (
                      <button
                        key={qq.id}
                        onClick={() => { setCurrentIdx(i); setPaletteOpen(false); }}
                        className={`grid h-11 place-items-center rounded-lg border text-sm font-semibold ${
                          current
                            ? "border-primary bg-primary text-primary-foreground"
                            : answered
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- Submit confirm ---- */}
      {confirm === "submit" && questions && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg font-bold">submit your paper?</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {answeredCount} of {totalQuestions} questions answered.
            </p>
            {answeredCount < totalQuestions && (
              <p className="mt-1 text-xs text-yellow-300/90">
                {totalQuestions - answeredCount} left blank — those will score 0.
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 rounded-xl border border-border py-3 text-sm">keep working</button>
              <button
                onClick={() => { setConfirm(null); void runBatchGrading(); }}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Close confirm ---- */}
      {confirm === "close" && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => setConfirm(null)}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg font-bold">leave without submitting?</div>
            <p className="mt-1 text-sm text-muted-foreground">your answers won't be saved.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirm(null)} className="flex-1 rounded-xl border border-border py-3 text-sm">keep working</button>
              <button
                onClick={() => { setConfirm(null); onClose(); }}
                className="flex-1 rounded-xl border border-red-500/40 py-3 text-sm text-red-400"
              >
                leave
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Resume-in-progress offer ---- */}
      {resumeOffer && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/75 p-4">
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <div className="text-3xl">📄</div>
            <div className="mt-2 font-display text-lg font-bold">resume your paper?</div>
            <p className="mt-1 text-sm text-muted-foreground">
              you have a <span className="font-semibold text-foreground">{subject}</span> paper
              ({resumeOffer.totalMarks} marks) in progress — {resumeOffer.answered}/{resumeOffer.total} answered.
            </p>
            {resumeOffer.reattach.size > 0 && (
              <p className="mt-1 text-[11px] text-yellow-300/90">
                {resumeOffer.reattach.size} photo answer{resumeOffer.reattach.size === 1 ? "" : "s"} will need to be reattached.
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                onClick={() => void declineResume()}
                className="flex-1 rounded-xl border border-border py-3 text-sm text-muted-foreground"
              >
                start fresh
              </button>
              <button
                onClick={acceptResume}
                className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                resume
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Download / print sheet ---- */}
      {downloadSheet && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onClick={() => setDownloadSheet(false)}>
          <div
            className="w-full max-w-sm rounded-t-3xl border border-border bg-card p-5 shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-display text-lg font-bold">download the paper 📄</div>
            <p className="mt-1 text-xs text-muted-foreground">questions only — no answers included. save as PDF or print on paper.</p>
            <div className="mt-4 space-y-2">
              <button
                onClick={() => void doPrintInApp()}
                className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
              >
                🖨️ print / save as PDF
              </button>
              <button
                onClick={() => void doOpenInBrowser()}
                className="w-full rounded-xl border border-border py-3 text-sm"
              >
                🌐 open in browser to save as PDF
              </button>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                on some Android versions in-app print doesn't work reliably — if the first option does nothing, use the browser option (opens Chrome, then use Chrome's Share → Print → Save as PDF).
              </p>
              <button
                onClick={() => setDownloadSheet(false)}
                className="w-full rounded-xl border border-border py-2 text-xs text-muted-foreground"
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    portalHost
  );
}

function PaperAnswerArea({
  q,
  draft,
  onDraft,
  onPhotoPick,
  photoInputRef,
  needsReattach = false,
}: {
  q: PaperQClient;
  draft: PaperDraft | undefined;
  onDraft: (next: PaperDraft | null) => void;
  onPhotoPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  photoInputRef: React.MutableRefObject<HTMLInputElement | null>;
  needsReattach?: boolean;
}) {
  if (q.type === "mcq") {
    const pick = draft && draft.kind === "mcq" ? draft.pick : null;
    return (
      <div className="mt-4 space-y-2">
        {q.options.map((opt, i) => {
          const picked = pick === i;
          return (
            <button
              key={i}
              onClick={() => onDraft({ kind: "mcq", pick: i })}
              className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                picked ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"
              }`}
            >
              <span className="mr-2 font-semibold text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  const mode: "text" | "photo" = draft?.kind === "photo" ? "photo" : "text";
  const value = draft?.kind === "text" ? draft.value : "";
  const photo = draft?.kind === "photo" ? draft : null;

  return (
    <div className="mt-4">
      {/* Hidden input is mounted unconditionally so its ref is available in
          both "type it" and "photo" modes — otherwise tapping the 📸 tab in
          text mode hits a null ref and nothing happens. */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={onPhotoPick}
      />
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onDraft(value.length > 0 ? { kind: "text", value } : null)}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
            mode === "text" ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground"
          }`}
        >
          ✍️ type it
        </button>
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
            mode === "photo" ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-card text-muted-foreground"
          }`}
        >
          📸 photo of your written answer
        </button>
      </div>

      {needsReattach && !draft && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-200">
          <span>📸 photo attached last time — reattach to submit this one.</span>
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="shrink-0 rounded-full border border-yellow-400/40 bg-yellow-500/10 px-2 py-1 text-[10px] font-semibold text-yellow-100"
          >
            reattach
          </button>
        </div>
      )}

      {mode === "text" ? (
        <>
          <textarea
            value={value}
            onChange={(e) => {
              const v = e.target.value.slice(0, 6000);
              onDraft(v.length > 0 ? { kind: "text", value: v } : null);
            }}
            placeholder={q.type === "long" ? "write your full answer here…" : "write your short answer here…"}
            rows={q.type === "long" ? 8 : 5}
            className="w-full rounded-xl border border-border bg-input/40 px-3 py-2.5 text-sm focus:outline-none"
          />
          <div className="mt-1 text-right text-[10px] text-muted-foreground">{value.length}/6000</div>
        </>
      ) : (
        <div>

          {photo ? (
            <div className="relative">
              <img
                src={photo.previewUrl}
                alt="Your handwritten answer"
                className="max-h-72 w-full rounded-xl border border-border bg-black/20 object-contain"
              />
              <button
                type="button"
                onClick={() => onDraft(null)}
                aria-label="Remove photo"
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/70 text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-input/30 py-8 text-sm text-muted-foreground hover:bg-muted"
            >
              <Camera className="h-4 w-4" /> take a photo of your answer
            </button>
          )}
          {photo && (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              className="mt-2 w-full rounded-xl border border-border py-2 text-[11px] text-muted-foreground"
            >
              retake photo
            </button>
          )}
        </div>
      )}
    </div>
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
  chapter: string | null;
  created_at: string;
};


function useAttempts() {
  return useQuery({
    queryKey: QUIZ_ATTEMPTS_KEY,
    // Always refetch when the dashboard mounts so a freshly finished paper
    // appears immediately, even if cache invalidation elsewhere was missed.
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async (): Promise<Attempt[]> => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            order: (col: string, opts: { ascending: boolean }) => Promise<{ data: Attempt[] | null; error: Error | null }>;
          };
        };
      })
        .from("quiz_attempts")
        .select("id, profile_id, subject, topic, total_questions, correct_count, total_marks, marks_scored, chapter, created_at")
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
                      {BOARD_UPPER[p.board]} · {p.class_level === "ug" ? "UG" : p.class_level === "pg" ? "PG" : p.class_level === "drop" ? "Drop year" : p.class_level === "aspirant" ? "Aspirant" : `Class ${p.class_level}`}
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
                        const { num, den } = attemptScore(r);
                        const isPaper = !!(r.total_marks && r.total_marks > 0);
                        return (
                          <div key={r.id} className="flex items-center justify-between text-xs">
                            <span className="truncate">
                              {r.subject}
                              {isPaper && <span className="ml-1 text-[9px] text-muted-foreground">· paper</span>}
                            </span>
                            <span className="text-muted-foreground">
                              {when} · {num}/{den}{isPaper ? "" : ""}
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

// ------------------------- Mock Test (timed, MCQ-only) -------------------------

type MockQClient = {
  id: string;
  type: "mcq";
  marks: number;
  subject: string;
  question: string;
  options: string[];
};

function formatCountdown(secondsLeft: number): string {
  const s = Math.max(0, Math.floor(secondsLeft));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function MockPaperModal({
  profile,
  subjects,
  durationMinutes,
  onClose,
}: {
  profile: LearnerProfile;
  subjects: string[];
  durationMinutes: 30 | 60 | 90;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paperId, setPaperId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<MockQClient[] | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [durationSec, setDurationSec] = useState<number>(durationMinutes * 60);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [phase, setPhase] = useState<"answering" | "grading" | "done">("answering");
  const [confirmClose, setConfirmClose] = useState(false);
  const [gradedCount, setGradedCount] = useState(0);
  const [results, setResults] = useState<Record<string, PaperGradeEntry>>({});
  const [totalScored, setTotalScored] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const finishedRef = useRef(false);
  const autoSubmittedRef = useRef(false);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const totalMarks = questions?.length ?? 0;

  // Mount full-screen portal host (same pattern as PaperModal).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const host = document.createElement("div");
    host.setAttribute("data-mock-modal-host", "true");
    Object.assign(host.style, {
      position: "fixed", top: "0", left: "0", right: "0", bottom: "0",
      width: "100vw", height: "100dvh", zIndex: "999", overflow: "hidden",
    });
    document.documentElement.appendChild(host);
    setPortalHost(host);
    return () => { host.remove(); setPortalHost(null); };
  }, []);

  // Wall-clock tick every second (works regardless of tab focus — we anchor
  // to server-provided started_at + duration_seconds, not a pausable local
  // counter).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secondsLeft = startedAtMs && durationSec
    ? Math.max(0, durationSec - Math.floor((nowMs - startedAtMs) / 1000))
    : durationSec;

  const generateFresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("study-paper-mock", {
        body: {
          profile: { board: profile.board, classLevel: profile.class_level },
          profileId: profile.id,
          subjects,
          durationMinutes,
        },
      });
      if (error) throw error;
      const d = data as {
        source?: string;
        paper_id?: string;
        questions?: MockQClient[];
        started_at?: string;
        duration_seconds?: number;
        reason?: string;
      };
      if (d?.source === "paper" && d.paper_id && Array.isArray(d.questions) && d.questions.length > 0 && d.started_at && d.duration_seconds) {
        setPaperId(d.paper_id);
        setQuestions(d.questions);
        setStartedAtMs(new Date(d.started_at).getTime());
        setDurationSec(d.duration_seconds);
        setPicks({});
        setCurrentIdx(0);
      } else {
        setErrorMsg("couldn't build that mock — try again 🌿");
      }
    } catch {
      setErrorMsg("couldn't build that mock — try again 🌿");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, profile.board, profile.class_level, subjects.join("|"), durationMinutes]);

  // Init: try resume (kind='mock') first; if expired, auto-finish; otherwise
  // resume with the correctly-reduced timer.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { data: res } = await supabase.functions.invoke("study-paper-resume", {
          body: { profile_id: profile.id, kind: "mock" },
        });
        if (cancelled) return;
        const r = res as {
          found?: boolean;
          paper_id?: string;
          total_marks?: number;
          questions?: MockQClient[];
          draft_answers?: Record<string, unknown>;
          started_at?: string | null;
          duration_seconds?: number | null;
        };
        if (
          r?.found && r.paper_id && Array.isArray(r.questions) && r.questions.length > 0 &&
          r.started_at && r.duration_seconds
        ) {
          const startedMs = new Date(r.started_at).getTime();
          const durSec = r.duration_seconds;
          setPaperId(r.paper_id);
          setQuestions(r.questions);
          setStartedAtMs(startedMs);
          setDurationSec(durSec);
          // Restore picks from draft_answers.
          const nextPicks: Record<string, number> = {};
          for (const [qid, d] of Object.entries(r.draft_answers ?? {})) {
            const dd = d as { kind?: string; value?: unknown };
            if (dd?.kind === "mcq" && typeof dd.value === "number" && dd.value >= 0 && dd.value <= 3) {
              nextPicks[qid] = dd.value;
            }
          }
          setPicks(nextPicks);
          setCurrentIdx(0);
          setLoading(false);
          // If time already expired while app was closed, auto-finish immediately.
          const elapsed = Math.floor((Date.now() - startedMs) / 1000);
          if (elapsed >= durSec) {
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            queueMicrotask(() => { void runBatchGrading(true); });
          }
          return;
        }
      } catch { /* fall through */ }
      if (!cancelled) await generateFresh();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, durationMinutes]);

  // Debounced autosave — persists MCQ pick as { kind: "mcq", value: n }.
  function scheduleSave(qid: string, pick: number) {
    if (!paperId) return;
    if (saveTimers.current[qid]) clearTimeout(saveTimers.current[qid]);
    saveTimers.current[qid] = setTimeout(async () => {
      try {
        await supabase.functions.invoke("study-paper-save-draft", {
          body: { paper_id: paperId, question_id: qid, draft: { kind: "mcq", value: pick } },
        });
      } catch { /* silent */ }
    }, 600);
  }

  function pickAnswer(qid: string, opt: number) {
    setPicks((prev) => ({ ...prev, [qid]: opt }));
    scheduleSave(qid, opt);
  }

  useEffect(() => {
    return () => { Object.values(saveTimers.current).forEach((t) => clearTimeout(t)); };
  }, []);

  const runBatchGrading = useCallback(async (timeExpired = false) => {
    if (!questions || !paperId || phase !== "answering") return;
    setPhase("grading");
    setGradedCount(0);
    setResults({});
    const perQ: Record<string, PaperGradeEntry> = {};
    if (timeExpired) toast.message("⏰ time's up! grading your paper…");

    await gradePool(questions, 4, async (qq) => {
      const answer = picks[qq.id];
      const requestBody: Record<string, unknown> = {
        paper_id: paperId,
        question_id: qq.id,
        answer: typeof answer === "number" ? answer : -1,
      };
      try {
        const { data, error } = await supabase.functions.invoke("study-paper-grade", { body: requestBody });
        if (error) throw error;
        const d = data as GradeResult & { source?: string };
        if (typeof d.awarded_marks !== "number") {
          perQ[qq.id] = { awarded: 0, max: qq.marks, feedback: "couldn't grade this one." };
        } else {
          perQ[qq.id] = {
            awarded: d.awarded_marks,
            max: d.max_marks ?? qq.marks,
            feedback: d.feedback ?? "",
            correct_index: d.correct_index,
          };
        }
      } catch {
        perQ[qq.id] = { awarded: 0, max: qq.marks, feedback: "couldn't grade this one." };
      }
    }, () => setGradedCount((c) => c + 1));

    const sum = Object.values(perQ).reduce((acc, r) => acc + r.awarded, 0);
    setResults(perQ);
    setTotalScored(sum);

    if (!finishedRef.current && paperId && questions) {
      finishedRef.current = true;
      setFinishing(true);
      try {
        await supabase.functions.invoke("study-paper-finish", {
          body: {
            paper_id: paperId,
            marks_scored: sum,
            total_marks: questions.length,
            subject: `Mock Test (${durationMinutes}m)`,
          },
        });
        qc.invalidateQueries({ queryKey: QUIZ_ATTEMPTS_KEY });
      } catch { /* best-effort */ }
      finally { setFinishing(false); }
    }
    setPhase("done");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, paperId, picks, phase, durationMinutes, qc]);

  // Auto-submit when the wall-clock hits zero.
  useEffect(() => {
    if (phase !== "answering") return;
    if (!startedAtMs || !questions) return;
    if (secondsLeft <= 0 && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      void runBatchGrading(true);
    }
  }, [secondsLeft, phase, startedAtMs, questions, runBatchGrading]);

  function requestClose() {
    if (phase === "done") { onClose(); return; }
    if (phase === "grading") return;
    setConfirmClose(true);
  }

  const answeredCount = questions ? questions.filter((qq) => typeof picks[qq.id] === "number").length : 0;
  const totalQuestions = questions?.length ?? 0;
  const q = questions?.[currentIdx] ?? null;
  const urgent = secondsLeft < 300;

  // Section groupings by subject, preserving first-seen order.
  const sections = (() => {
    if (!questions) return [] as { subject: string; label: string; items: { qq: MockQClient; i: number }[] }[];
    const order: string[] = [];
    const byS = new Map<string, { qq: MockQClient; i: number }[]>();
    questions.forEach((qq, i) => {
      if (!byS.has(qq.subject)) { byS.set(qq.subject, []); order.push(qq.subject); }
      byS.get(qq.subject)!.push({ qq, i });
    });
    return order.map((s, k) => ({
      subject: s,
      label: `SECTION ${String.fromCharCode(65 + k)} — ${s}`,
      items: byS.get(s)!,
    }));
  })();

  const sectionForCurrent = q ? sections.find((s) => s.items.some((it) => it.qq.id === q.id)) : null;

  const pct = totalMarks > 0 ? Math.round((totalScored / totalMarks) * 100) : 0;

  if (!portalHost) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-background text-foreground"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, width: "100vw", height: "100dvh", zIndex: 999 }}
    >
      {/* Top bar with countdown */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button onClick={requestClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border">
          <X className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">mock test</div>
          <div className="truncate font-display text-sm font-bold">
            {durationMinutes} min · {totalQuestions || DURATION_TO_TOTAL_CLIENT[durationMinutes]} MCQs
          </div>
        </div>
        {phase === "answering" && startedAtMs ? (
          <div
            className={`shrink-0 rounded-full border px-3 py-1.5 font-mono text-sm font-bold tabular-nums ${
              urgent
                ? "border-red-500/60 bg-red-500/15 text-red-300 animate-pulse"
                : "border-amber-500/40 bg-amber-500/10 text-amber-200"
            }`}
            aria-label="Time remaining"
          >
            ⏱ {formatCountdown(secondsLeft)}
          </div>
        ) : (
          <div className="w-[92px]" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
        {loading && (
          <div className="mt-20 text-center text-sm text-muted-foreground">
            building your mock test… 🕐
          </div>
        )}

        {!loading && errorMsg && (
          <div className="mt-20 px-6 text-center">
            <div className="text-4xl">🌿</div>
            <p className="mt-2 text-sm text-muted-foreground">{errorMsg}</p>
            <button onClick={onClose} className="mt-4 rounded-xl border border-border px-4 py-2 text-sm">close</button>
          </div>
        )}

        {!loading && !errorMsg && phase === "grading" && questions && (
          <div className="mt-24 px-6 text-center">
            <div className="text-4xl">📝</div>
            <div className="mt-3 font-display text-lg font-bold">grading your paper…</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {gradedCount}/{questions.length} graded
            </div>
            <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${questions.length ? Math.min(100, (gradedCount / questions.length) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}

        {!loading && !errorMsg && phase === "done" && questions && (
          <div className="mx-auto max-w-2xl px-4 pt-6">
            <div className="text-center">
              <div className="text-5xl">{pct >= 90 ? "🏆" : pct >= 60 ? "🎉" : "🌱"}</div>
              <div className="mt-2 font-display text-2xl font-bold">
                you scored {totalScored}/{totalMarks}!
              </div>
              <div className="text-xs text-muted-foreground">that's {pct}%</div>
              {finishing && <div className="mt-2 text-[10px] text-muted-foreground">saving…</div>}
            </div>

            <div className="mt-6 space-y-4 pb-6">
              {sections.map((sec) => {
                const secItems = sec.items;
                const secNum = secItems.reduce((acc, it) => acc + (results[it.qq.id]?.awarded ?? 0), 0);
                const secDen = secItems.length;
                return (
                  <div key={sec.subject} className="rounded-xl border border-border bg-background/40 p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{sec.label}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{secNum}/{secDen}</div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {secItems.map(({ qq, i }) => {
                        const r = results[qq.id];
                        if (!r) return null;
                        const correct = r.awarded === r.max;
                        return (
                          <div
                            key={qq.id}
                            className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                              correct ? "border-green-500/30 bg-green-500/5" : "border-red-500/20 bg-red-500/5"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="font-semibold">Q{i + 1}</div>
                              <div className={`font-mono ${correct ? "text-green-300" : "text-red-300"}`}>{r.awarded}/{r.max}</div>
                            </div>
                            <div className="mt-0.5 line-clamp-2 text-muted-foreground">{qq.question}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={onClose}
              disabled={finishing}
              className="mb-6 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              done
            </button>
          </div>
        )}

        {!loading && !errorMsg && phase === "answering" && questions && q && (
          <>
            {/* Palette strip */}
            <div className="sticky top-0 z-[5] border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
              <div className="flex items-center gap-2">
                <div className="flex-1 overflow-x-auto">
                  <div className="flex items-center gap-1.5">
                    {questions.map((qq, i) => {
                      const answered = typeof picks[qq.id] === "number";
                      const current = i === currentIdx;
                      return (
                        <button
                          key={qq.id}
                          onClick={() => setCurrentIdx(i)}
                          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold transition ${
                            current
                              ? "border-primary bg-primary text-primary-foreground"
                              : answered
                              ? "border-primary/40 bg-primary/15 text-primary"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="shrink-0 rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground"
                >
                  ⊞ all
                </button>
                <button
                  onClick={() => void runBatchGrading(false)}
                  className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground"
                >
                  submit
                </button>
              </div>
              <div className="mt-1.5 text-center text-[10px] text-muted-foreground">
                {answeredCount}/{totalQuestions} answered
              </div>
            </div>

            <div className="mx-auto max-w-2xl px-4 pt-4">
              <div
                className="rounded-2xl border border-stone-300 p-5 font-serif text-stone-900 shadow-[0_2px_10px_rgba(0,0,0,0.35)]"
                style={{ background: "#f7f1e3" }}
              >
                <div className="text-center">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-700">
                    {BOARD_UPPER[profile.board]}
                  </div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-stone-600">MOCK TEST</div>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-0.5 text-[11px] text-stone-800">
                    <span><span className="font-semibold">Questions:</span> {totalQuestions}</span>
                    <span><span className="font-semibold">Total Duration:</span> {durationMinutes} min</span>
                    <span><span className="font-semibold">Marks:</span> 1 each · no negative</span>
                  </div>
                </div>
                <div className="my-3 border-t border-stone-400/60" />

                {sectionForCurrent && (
                  <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-widest text-stone-700">
                    {sectionForCurrent.label}
                  </div>
                )}

                <div className="flex items-baseline justify-between gap-3 text-[11px] text-stone-600">
                  <span>Question {currentIdx + 1} of {totalQuestions}</span>
                  <span>[{q.marks} {q.marks === 1 ? "mark" : "marks"}]</span>
                </div>

                <div className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900">
                  <span className="font-semibold">Q{currentIdx + 1}. </span>{q.question}
                </div>
              </div>

              {/* MCQ options */}
              <div className="mt-4 space-y-2">
                {q.options.map((opt, i) => {
                  const picked = picks[q.id] === i;
                  return (
                    <button
                      key={i}
                      onClick={() => pickAnswer(q.id, i)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                        picked ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      <span className="mr-2 font-semibold text-muted-foreground">{String.fromCharCode(65 + i)}.</span>
                      {opt}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex items-center gap-2">
                <button
                  onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
                  disabled={currentIdx === 0}
                  className="flex-1 rounded-xl border border-border py-3 text-sm text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  ← prev
                </button>
                <button
                  onClick={() => setCurrentIdx(Math.min(totalQuestions - 1, currentIdx + 1))}
                  disabled={currentIdx >= totalQuestions - 1}
                  className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
                >
                  next →
                </button>
              </div>
              <div className="pb-6" />
            </div>
          </>
        )}
      </div>

      {/* Palette overlay — grouped by subject */}
      {paletteOpen && questions && (
        <div className="fixed inset-0 z-[80] flex flex-col bg-background/95 backdrop-blur">
          <div
            className="flex items-center justify-between border-b border-border px-4 py-3"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <div className="font-display text-sm font-bold">all questions</div>
            <button onClick={() => setPaletteOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-border">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {sections.map((sec) => (
              <div key={sec.subject} className="mb-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{sec.label}</div>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                  {sec.items.map(({ qq, i }) => {
                    const answered = typeof picks[qq.id] === "number";
                    const current = i === currentIdx;
                    return (
                      <button
                        key={qq.id}
                        onClick={() => { setCurrentIdx(i); setPaletteOpen(false); }}
                        className={`grid h-11 place-items-center rounded-lg border text-sm font-semibold ${
                          current
                            ? "border-primary bg-primary text-primary-foreground"
                            : answered
                            ? "border-primary/40 bg-primary/15 text-primary"
                            : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmClose && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => setConfirmClose(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="font-display text-lg font-bold">leave the mock test?</div>
            <p className="mt-1 text-sm text-muted-foreground">
              the timer keeps running — you can resume, but when time hits zero the paper auto-submits.
            </p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmClose(false)} className="flex-1 rounded-xl border border-border py-3 text-sm">keep going</button>
              <button
                onClick={() => { setConfirmClose(false); onClose(); }}
                className="flex-1 rounded-xl border border-red-500/40 py-3 text-sm text-red-400"
              >
                leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    portalHost,
  );
}

// Local mirror of the server-side duration→count mapping so the top bar can
// show a count before the paper has finished generating.
const DURATION_TO_TOTAL_CLIENT: Record<number, number> = { 30: 50, 60: 100, 90: 150 };


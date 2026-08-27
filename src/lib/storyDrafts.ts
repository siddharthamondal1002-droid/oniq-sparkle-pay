/**
 * Story drafts — structured stories kept WITHOUT a render.
 *
 * Mega loop, 2026-08-27: story generation and video rendering are separate
 * products. `story-plot` already stops at the structured story — it returns
 * the plan to its caller, writes no rows and dispatches nothing — so a draft
 * is that plan, kept. Rendering stays exactly where it always was: behind the
 * explicit, paid `claim_story_seconds` tap in the studio. Nothing in this
 * module can start a film: it has no supabase import, no RPC, no network.
 *
 * WHY LOCAL, like the cast library: a draft is the user's creative property
 * and carries no server meaning until the moment they choose to make it —
 * at which point the PROMPT rides the existing claim flow unchanged. Losing
 * the listing loses nothing that cannot be retyped or regenerated.
 *
 * The validator is deliberately strict about SHAPE and forgiving about
 * CONTENT: a draft stores exactly the fields the plan grammar defines
 * (title, logline, setting, cast name+lock, shot still/narration/motion/
 * dialogue/vfx) with everything unknown stripped — and it imposes nothing.
 * A cast entry is a name and free prose; no identity field exists here.
 */

export type DraftCastMember = { name: string; lock: string };

export type DraftDialogue = { speaker: string; line: string };

export type DraftShot = {
  still: string;
  narration: string;
  motion?: string;
  dialogue?: DraftDialogue;
  vfx?: string;
};

export type StoryDraftPlan = {
  title: string;
  logline: string;
  setting: string;
  cast: DraftCastMember[];
  shots: DraftShot[];
};

export type StoryDraft = {
  id: string;
  /** The user's prompt, kept so "make this film" can prefill the studio. */
  prompt: string;
  /** The duration the shot count was planned for. */
  seconds: number;
  plan: StoryDraftPlan;
  /** Which engine answered ("claude" | "gemini"), when the reply said. */
  servedBy?: string;
  createdAt: string;
};

/** Bounds. Mirrors the pipeline's own: cast per film is 6, shots ~8.5/min. */
export const MAX_DRAFTS = 12;
export const MAX_DRAFT_SHOTS = 90;
export const MAX_DRAFT_CAST = 12;
const MAX_FIELD = 2000;
const MAX_LOCK = 400;
const MAX_NAME = 60;

const s = (v: unknown, cap: number): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, cap) : null;

/**
 * The structured story a reply claims to be, validated — or null.
 *
 * Strict where wrongness would poison later use (missing title/shots, a shot
 * with no still or narration, non-array cast), lenient where the field is
 * optional by grammar (motion, dialogue, vfx). Unknown fields are stripped,
 * never stored: a draft holds the contract, not the reply.
 */
export function parseStoryPlan(raw: unknown): StoryDraftPlan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;

  const title = s(p.title, 200);
  const logline = s(p.logline, MAX_FIELD);
  const setting = s(p.setting, MAX_FIELD);
  if (!title || !logline || !setting) return null;

  if (!Array.isArray(p.cast) || p.cast.length > MAX_DRAFT_CAST) return null;
  const cast: DraftCastMember[] = [];
  for (const c of p.cast) {
    const o = (c ?? {}) as Record<string, unknown>;
    const name = s(o.name, MAX_NAME);
    const lock = s(o.lock, MAX_LOCK);
    if (!name || !lock) return null;
    cast.push({ name, lock });
  }

  if (!Array.isArray(p.shots) || p.shots.length === 0 || p.shots.length > MAX_DRAFT_SHOTS) {
    return null;
  }
  const shots: DraftShot[] = [];
  for (const sh of p.shots) {
    const o = (sh ?? {}) as Record<string, unknown>;
    const still = s(o.still, MAX_FIELD);
    const narration = s(o.narration, MAX_FIELD);
    if (!still || !narration) return null;
    const shot: DraftShot = { still, narration };
    const motion = s(o.motion, MAX_FIELD);
    if (motion) shot.motion = motion;
    const vfx = s(o.vfx, MAX_FIELD);
    if (vfx) shot.vfx = vfx;
    const d = (o.dialogue ?? null) as Record<string, unknown> | null;
    if (d && typeof d === "object") {
      const speaker = s(d.speaker, MAX_NAME);
      const line = s(d.line, 400);
      if (speaker && line) shot.dialogue = { speaker, line };
    }
    shots.push(shot);
  }

  return { title, logline, setting, cast, shots };
}

// --- character ↔ scene links -------------------------------------------------

/**
 * The shots a character appears in, best effort and deterministic.
 *
 * The plan grammar makes locks verbatim in every still that shows the
 * character, so lock inclusion is the strong signal; the name as a whole
 * word is the weak one. A character matching no shot is a valid answer —
 * plenty of good shots show hands, objects and doorways on purpose.
 */
export function shotsFeaturing(plan: StoryDraftPlan, member: DraftCastMember): number[] {
  const name = member.name.toLowerCase();
  const lock = member.lock.toLowerCase();
  const nameRe = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const out: number[] = [];
  for (let i = 0; i < plan.shots.length; i++) {
    const hay = plan.shots[i].still.toLowerCase();
    const spoken = plan.shots[i].dialogue?.speaker.toLowerCase() === name;
    if (hay.includes(lock) || nameRe.test(plan.shots[i].still) || spoken) out.push(i);
  }
  return out;
}

/** The cast present in one shot — the inverse view, same matching. */
export function castInShot(plan: StoryDraftPlan, shotIndex: number): DraftCastMember[] {
  return plan.cast.filter((m) => shotsFeaturing(plan, m).includes(shotIndex));
}

// --- the draft store ---------------------------------------------------------

const KEY = "oniq.storyDrafts.v1";

function read(): StoryDraft[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoryDraft[]) : [];
  } catch {
    return [];
  }
}

function write(list: StoryDraft[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export function listDrafts(): StoryDraft[] {
  return read();
}

/** Keep a validated plan. Returns the stored draft, or null when invalid. */
export function saveDraft(
  prompt: string,
  seconds: number,
  rawPlan: unknown,
  servedBy?: string,
): StoryDraft | null {
  const plan = parseStoryPlan(rawPlan);
  if (!plan) return null;
  const p = prompt.trim().slice(0, 5000);
  if (!p || !Number.isFinite(seconds) || seconds <= 0) return null;
  const draft: StoryDraft = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    prompt: p,
    seconds: Math.round(seconds),
    plan,
    ...(servedBy ? { servedBy } : {}),
    createdAt: new Date().toISOString(),
  };
  const list = read();
  list.unshift(draft);
  write(list.slice(0, MAX_DRAFTS));
  return draft;
}

export function deleteDraft(id: string) {
  write(read().filter((d) => d.id !== id));
}

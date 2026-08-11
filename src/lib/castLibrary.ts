/**
 * The cast library — characters a user keeps between films.
 *
 * WHY LOCAL. The characters themselves are the user's creative property and
 * carry no server meaning until the moment a film is made — at which point the
 * chosen ones are attached to that one job via `set_story_cast` and travel to
 * the planner as `reuse`. Storing the library client-side keeps the server
 * schema to what billing and rendering actually need, and losing the listing
 * (app data cleared) loses nothing a user can't retype: the LOCK TEXT is the
 * character.
 *
 * A lock is a verbatim physical description — age, build, hair, clothing,
 * colours — because that is the only thing that survives between generations.
 * Same mechanism as the episode cast locks; see story-plot's rules.
 *
 * AUTHORING SIDE: characters designed in Adobe (Firefly) are ingested by
 * writing their description here; the sheet image itself stays in the user's
 * Adobe library. The description is what the pipeline consumes.
 */

export type CastMember = {
  id: string;
  name: string;
  /** The verbatim physical description repeated in every still. */
  lock: string;
  createdAt: string;
};

const KEY = "oniq.castLibrary.v1";
export const MAX_CAST_PER_FILM = 6;
export const MAX_NAME = 60;
export const MAX_LOCK = 400;

function read(): CastMember[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CastMember[]) : [];
  } catch {
    return [];
  }
}

function write(list: CastMember[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export function listCast(): CastMember[] {
  return read();
}

export function saveCastMember(name: string, lock: string): CastMember | null {
  const n = name.trim().slice(0, MAX_NAME);
  const l = lock.trim().slice(0, MAX_LOCK);
  if (!n || !l) return null;
  const member: CastMember = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name: n,
    lock: l,
    createdAt: new Date().toISOString(),
  };
  const list = read();
  list.unshift(member);
  write(list.slice(0, 24)); // a library, not a database
  return member;
}

export function deleteCastMember(id: string) {
  write(read().filter((m) => m.id !== id));
}

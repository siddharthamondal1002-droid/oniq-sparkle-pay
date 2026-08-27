// The story_actor_assets migration, pinned (mega loop, 2026-08-27). The
// schema IS the contract: private bytes, owner-only rows, RPC-gated inserts
// with a hard per-user bound, and not one identity column beyond the user's
// own free-prose name and lock.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/20260827100000_story_actor_assets.sql"),
  "utf8",
);

describe("the bucket", () => {
  it("is private, and every policy reads the owner out of the path", () => {
    expect(SQL).toContain("values ('story-actors', 'story-actors', false)");
    for (const verb of ["insert", "select", "delete"]) {
      expect(SQL, verb).toMatch(
        new RegExp(`for ${verb} to authenticated[\\s\\S]{0,200}bucket_id = 'story-actors'`),
      );
    }
    expect(SQL.match(/\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g)?.length).toBe(
      3,
    );
  });
});

describe("the table", () => {
  it("bounds mirror the cast library, and the mime set is closed", () => {
    expect(SQL).toContain("char_length(name) between 1 and 60");
    expect(SQL).toContain("char_length(lock) between 1 and 400");
    expect(SQL).toContain("mime in ('image/png', 'image/jpeg', 'image/webp')");
  });

  it("source admits only generated images — user photos are not identities here", () => {
    expect(SQL).toContain("check (source = 'generated')");
  });

  it("carries no identity column — the lock prose IS the character", () => {
    // The columns are exactly: id, user_id, name, lock, style, storage_path,
    // mime, source, created_at. Nothing for ethnicity, gender, age,
    // occupation, region, religion or any other imposed attribute.
    const tableDef = SQL.slice(
      SQL.indexOf("create table if not exists public.story_actor_assets"),
      SQL.indexOf("create index if not exists story_actor_assets_user_idx"),
    );
    for (const col of [
      "ethnicity",
      "gender",
      "age",
      "occupation",
      "region",
      "religion",
      "nationality",
    ]) {
      // As a COLUMN — a line starting with the name ("age" inside
      // "storage_path" is not a column).
      expect(tableDef, col).not.toMatch(new RegExp(`^\\s*${col}[\\s,]`, "m"));
    }
  });

  it("rows are owner-only: RLS on, select/delete policies, no client insert or update", () => {
    expect(SQL).toContain("alter table public.story_actor_assets enable row level security");
    expect(SQL).toContain("grant select, delete on public.story_actor_assets to authenticated");
    expect(SQL).not.toMatch(/grant[^;]*insert[^;]*on public\.story_actor_assets to authenticated/i);
    expect(SQL).not.toMatch(/grant[^;]*update[^;]*on public\.story_actor_assets to authenticated/i);
    expect(SQL).toMatch(/for select to authenticated[\s\S]{0,80}user_id = auth\.uid\(\)/);
    expect(SQL).toMatch(/for delete to authenticated[\s\S]{0,80}user_id = auth\.uid\(\)/);
    expect(SQL).not.toMatch(/create policy[^;]*for (insert|update)[^;]*story_actor_assets/i);
  });
});

describe("save_story_actor — the only write path", () => {
  it("is security definer with a pinned search_path", () => {
    expect(SQL).toMatch(
      /function public\.save_story_actor[\s\S]{0,400}security definer[\s\S]{0,80}set search_path = public/,
    );
  });

  it("re-checks the owner-folder rule so a row can never point elsewhere", () => {
    expect(SQL).toContain("_path not like (me::text || '/%')");
  });

  it("bounds the library hard — 24 assets, then refusal, not growth", () => {
    expect(SQL).toMatch(/if n >= 24 then[\s\S]{0,120}'library-full'/);
  });

  it("is granted to authenticated and revoked from everyone else", () => {
    expect(SQL).toContain(
      "revoke all on function public.save_story_actor(text, text, text, text, text) from public, anon",
    );
    expect(SQL).toContain(
      "grant execute on function public.save_story_actor(text, text, text, text, text) to authenticated",
    );
  });
});

describe("no implicit cascade — the schema cannot start a film", () => {
  it("touches no job table, no dispatch, no GPU surface", async () => {
    const { stripSqlComments } = await import("@/test/sourceText");
    const executable = stripSqlComments(SQL);
    for (const term of ["story_jobs", "claim_story_seconds", "gpu_video", "dispatch"]) {
      expect(executable, term).not.toContain(term);
    }
  });
});

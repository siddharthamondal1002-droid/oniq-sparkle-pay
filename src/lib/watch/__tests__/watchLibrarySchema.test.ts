/**
 * The Watch library's schema, pinned from the migration file: every table is
 * user-owned with row-level security on all four verbs, link tables also
 * check the referenced rows belong to the caller, and the constraints that
 * keep the data honest are present. Existing Watch tables are untouched.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SQL = readFileSync(
  join(ROOT, "supabase/migrations/20260903150000_watch_library.sql"),
  "utf8",
);
const TYPES = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");

const TABLES = [
  "watch_items",
  "watch_collections",
  "watch_collection_items",
  "watch_threads",
  "watch_thread_items",
  "watch_moments",
];

describe("watch library schema", () => {
  it.each(TABLES)("%s is created, user-owned, RLS-enabled with four own-row policies", (t) => {
    expect(SQL).toMatch(new RegExp(`create table public\\.${t} \\(`));
    expect(SQL).toMatch(
      new RegExp(
        `create table public\\.${t} \\([^;]*user_id uuid not null references public\\.profiles\\(id\\) on delete cascade`,
      ),
    );
    expect(SQL).toContain(`alter table public.${t} enable row level security;`);
    for (const verb of ["select", "insert", "update", "delete"]) {
      const re = new RegExp(
        `create policy "[^"]+" on public\\.${t}\\s+for ${verb} to authenticated[^;]*auth\\.uid\\(\\)`,
        "i",
      );
      expect(SQL, `${t} ${verb} policy`).toMatch(re);
    }
    expect(SQL).toContain(`grant select, insert, update, delete on public.${t} to authenticated;`);
    expect(SQL).toContain(`grant all on public.${t} to service_role;`);
  });

  it("link tables refuse attaching a stranger's item, collection or thread", () => {
    for (const t of ["watch_collection_items", "watch_thread_items", "watch_moments"]) {
      const insert =
        SQL.match(
          new RegExp(
            `create policy "[^"]+" on public\\.${t}\\s+for insert to authenticated with check \\(([^;]*)\\);`,
            "i",
          ),
        )?.[1] ?? "";
      expect(insert, `${t} insert policy`).toContain(
        "exists (select 1 from public.watch_items i where i.id = item_id and i.user_id = auth.uid())",
      );
    }
    expect(SQL).toContain(
      "exists (select 1 from public.watch_collections c where c.id = collection_id and c.user_id = auth.uid())",
    );
    expect(SQL).toContain(
      "exists (select 1 from public.watch_threads t where t.id = thread_id and t.user_id = auth.uid())",
    );
  });

  it("keeps the data honest: one row per (user, provider, id), bounded enums, sane numbers", () => {
    expect(SQL).toContain(
      "constraint watch_items_user_provider_content_key unique (user_id, provider, content_id)",
    );
    expect(SQL).toContain(
      "check (provider in ('youtube', 'vimeo', 'nebula', 'internet_archive', 'dailymotion', 'twitch'))",
    );
    expect(SQL).toContain("check (state in ('inbox', 'library', 'archived'))");
    expect(SQL).toMatch(
      /reason in\s*\('watch_later', 'research', 'learn', 'inspiration', 'reference', 'share', 'oniq'\)/,
    );
    expect(SQL).toContain("check (priority between 0 and 3)");
    expect(SQL).toContain("check (position_seconds >= 0)");
    expect(SQL).toContain("constraint watch_collections_user_name_key unique (user_id, name)");
    expect(SQL).toContain("constraint watch_threads_user_name_key unique (user_id, name)");
    expect(SQL).toContain("primary key (collection_id, item_id)");
    expect(SQL).toContain("primary key (thread_id, item_id)");
  });

  it("cascades a deleted item or parent through the link tables, and never stores media", () => {
    expect(SQL).toContain(
      "item_id uuid not null references public.watch_items(id) on delete cascade",
    );
    expect(SQL).toContain(
      "collection_id uuid not null references public.watch_collections(id) on delete cascade",
    );
    expect(SQL).toContain(
      "thread_id uuid not null references public.watch_threads(id) on delete cascade",
    );
    expect(SQL).toContain(
      "collection_id uuid references public.watch_collections(id) on delete set null",
    );
    const code = SQL.split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/stream_url|media_url|file_url|transcript/i);
    expect(SQL).not.toMatch(/drop table|truncate/i);
  });

  it("indexes the lists that grow", () => {
    expect(SQL).toContain(
      "create index watch_items_user_state_saved_idx on public.watch_items (user_id, state, saved_at desc);",
    );
    expect(SQL).toContain(
      "create index watch_items_user_watched_idx on public.watch_items (user_id, last_watched_at desc);",
    );
    expect(SQL).toContain("using gin (topics)");
  });

  it("does not touch the existing Watch tables", () => {
    for (const t of ["user_channels", "user_watch_genres", "user_watch_channels"]) {
      expect(SQL).not.toMatch(new RegExp(`alter table public\\.${t}|drop table public\\.${t}`));
    }
  });

  it.each(TABLES)("the typed client knows %s", (t) => {
    expect(TYPES).toContain(`      ${t}: {`);
  });
});

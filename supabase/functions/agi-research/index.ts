import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/llm.ts";

const REPOSITORY = "siddharthamondal1002-droid/oniq-sparkle-pay";
const DEFAULT_BRANCH = "main";
const VERIFIED_CHECKPOINT = "4ab803407d9cc343262f32ff538863154c2bd4e1";
const CONFIRMATION_PHRASE = "CREATE RESEARCH ISSUE";
const MAX_FILES = 6;
const MAX_FILE_BYTES = 80_000;
const TEXT_FILE = /\.(?:md|ts|tsx|js|mjs|json|toml|yml|yaml|sql)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AdminContext = {
  db: ReturnType<typeof createClient>;
  userId: string;
};

type TreeRow = {
  path?: unknown;
  sha?: unknown;
  size?: unknown;
  type?: unknown;
};

type RankedTreeRow = TreeRow & { path: string; sha: string; score: number };

function githubHeaders(write = false): Record<string, string> {
  const token = Deno.env.get("ONIQ_RESEARCH_GITHUB_TOKEN");
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ONIQ-AGI-Research-Lab",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(write ? { "Content-Type": "application/json" } : {}),
  };
}

async function github(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const headers = new Headers(init.headers);
    for (const [key, value] of Object.entries(githubHeaders(init.method === "POST"))) {
      headers.set(key, value);
    }
    return await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requireAdmin(req: Request): Promise<AdminContext | Response> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token) return json(401, { error: "Unauthorized" });
  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: userRes, error: userErr } = await db.auth.getUser(token);
  if (userErr || !userRes.user) return json(401, { error: "Unauthorized" });
  const { data: isAdmin } = await db.rpc("is_admin", { _uid: userRes.user.id });
  if (isAdmin !== true) return json(403, { error: "Admins only" });
  return { db, userId: userRes.user.id };
}

async function repositoryState() {
  const response = await github(`/branches/${DEFAULT_BRANCH}`);
  if (!response.ok) return { commit: null };
  const body = await response.json();
  return { commit: typeof body?.commit?.sha === "string" ? body.commit.sha : null };
}

function excerpt(source: string, terms: string[]): string {
  const lower = source.toLowerCase();
  const hit = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, hit - 500);
  const end = Math.min(source.length, start + 2400);
  return `${start > 0 ? "...\n" : ""}${source.slice(start, end)}${end < source.length ? "\n..." : ""}`;
}

async function research(query: string) {
  const state = await repositoryState();
  if (!state.commit) return json(502, { error: "Could not resolve the repository revision" });
  const treeResponse = await github(`/git/trees/${state.commit}?recursive=1`);
  if (!treeResponse.ok) return json(502, { error: "Could not read the repository tree" });
  const treeBody = await treeResponse.json();
  const terms = query.toLowerCase().split(/[^a-z0-9_.-]+/).filter((term) => term.length > 1).slice(0, 8);
  const rows = Array.isArray(treeBody?.tree) ? treeBody.tree : [];
  const candidates: RankedTreeRow[] = (rows as TreeRow[])
    .filter(
      (row) =>
        row.type === "blob" &&
        typeof row.path === "string" &&
        typeof row.sha === "string" &&
        TEXT_FILE.test(row.path) &&
        Number(row.size) <= MAX_FILE_BYTES,
    )
    .map((row) => {
      const path = String(row.path);
      return {
        ...row,
        path,
        sha: String(row.sha),
        score: terms.reduce(
          (sum, term) => sum + (path.toLowerCase().includes(term) ? 1 : 0),
          0,
        ),
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_FILES);

  const evidence = [];
  for (const candidate of candidates) {
    const blobResponse = await github(`/git/blobs/${candidate.sha}`);
    if (!blobResponse.ok) continue;
    const blob = await blobResponse.json();
    if (blob?.encoding !== "base64" || typeof blob?.content !== "string") continue;
    const source = new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\n/g, "")), (char) => char.charCodeAt(0)));
    evidence.push({
      path: candidate.path,
      url: `https://github.com/${REPOSITORY}/blob/${state.commit}/${candidate.path}`,
      excerpt: excerpt(source, terms),
    });
  }
  return json(200, { repository: REPOSITORY, branch: DEFAULT_BRANCH, commit: state.commit, evidence });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const auth = await requireAdmin(req);
  if (auth instanceof Response) return auth;
  const body = await req.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "capabilities";
  const writerConfigured = Boolean(Deno.env.get("ONIQ_RESEARCH_GITHUB_TOKEN"));

  if (action === "capabilities") {
    const state = await repositoryState();
    return json(200, {
      repository: { name: REPOSITORY, branch: DEFAULT_BRANCH, commit: state.commit, checkpoint: VERIFIED_CHECKPOINT },
      capabilities: [
        { id: "repository_research", label: "Repository-backed research", mode: "read", available: state.commit !== null, detail: "Bounded evidence excerpts from text files at the server-resolved default-branch commit." },
        { id: "oqca_observe", label: "OQCA production observation", mode: "read", available: true, detail: "Existing admin-only bounded observer; production tool-call budget remains zero." },
        { id: "create_research_issue", label: "Create research backlog issue", mode: "write", available: writerConfigured, detail: writerConfigured ? "One reversible GitHub issue after a short-lived, one-time confirmation." : "Disabled until a least-privilege server-only GitHub token is configured." },
      ],
    });
  }

  if (action === "research") {
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 120) return json(400, { error: "Query must be 2-120 characters" });
    return research(query);
  }

  if (action === "stage_write") {
    if (!writerConfigured) return json(503, { error: "Repository writes are not configured" });
    if (body?.kind !== "issue") return json(400, { error: "Only research issues are supported" });
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const issueBody = typeof body?.body === "string" ? body.body.trim() : "";
    if (title.length < 8 || title.length > 160 || issueBody.length < 20 || issueBody.length > 6000) return json(400, { error: "Invalid issue title or body" });
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const { data, error } = await auth.db
      .from("agi_research_write_requests")
      .insert({ created_by: auth.userId, repository: REPOSITORY, kind: "issue", payload: { title, body: issueBody }, expires_at: expiresAt })
      .select("id")
      .single();
    if (error || !data) return json(503, { error: "Write confirmation store is unavailable" });
    return json(200, { requestId: data.id, confirmationPhrase: CONFIRMATION_PHRASE, expiresAt });
  }

  if (action === "confirm_write") {
    if (!writerConfigured) return json(503, { error: "Repository writes are not configured" });
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    if (!UUID.test(requestId) || body?.confirmation !== CONFIRMATION_PHRASE) return json(400, { error: "Confirmation did not match" });
    const { data: request, error } = await auth.db
      .from("agi_research_write_requests")
      .update({ status: "executing", confirmed_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("created_by", auth.userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("payload")
      .maybeSingle();
    if (error || !request) return json(409, { error: "Write request is expired, already used, or unavailable" });

    const payload = request.payload as { title?: string; body?: string };
    const response = await github("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: `[Research Lab] ${payload.title}`,
        body: `${payload.body}\n\n---\nCreated from ONIQ AGI Research Lab after explicit in-app confirmation. Request: ${requestId}`,
      }),
    });
    if (!response.ok) {
      await auth.db.from("agi_research_write_requests").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", requestId).eq("status", "executing");
      return json(502, { error: "GitHub rejected the confirmed write; it will not be retried automatically" });
    }
    const created = await response.json();
    await auth.db.from("agi_research_write_requests").update({ status: "completed", completed_at: new Date().toISOString(), result_url: created.html_url }).eq("id", requestId).eq("status", "executing");
    return json(200, { issueUrl: created.html_url, issueNumber: created.number });
  }

  return json(400, { error: "Unknown action" });
});

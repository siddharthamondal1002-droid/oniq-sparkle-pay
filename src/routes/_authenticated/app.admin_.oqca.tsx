import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Bot, CheckCircle2, FlaskConical, Github, Loader2, ShieldCheck } from "lucide-react";
import { OniqHeader } from "@/components/oniq/OniqHeader";
import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeError";

export const Route = createFileRoute("/_authenticated/app/admin_/oqca")({
  head: () => ({
    meta: [
      { title: "ONIQ AGI Research Lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResearchLab,
});

type CapabilityResponse = {
  repository: { name: string; branch: string; commit: string | null; checkpoint: string };
  capabilities: Array<{ id: string; label: string; mode: "read" | "write"; available: boolean; detail: string }>;
};

type Evidence = { path: string; url: string; excerpt: string };
type StagedWrite = { requestId: string; confirmationPhrase: string; expiresAt: string };

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("agi-research", { body });
  if (error) throw new Error(await edgeErrorMessage(error));
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

function ResearchLab() {
  const [mode, setMode] = useState<"research" | "agent" | "write">("research");
  const [capabilities, setCapabilities] = useState<CapabilityResponse | null>(null);
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [objective, setObjective] = useState("");
  const [details, setDetails] = useState("");
  const [staged, setStaged] = useState<StagedWrite | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState<{ url: string; label: string; runId?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<CapabilityResponse>({ action: "capabilities" })
      .then(setCapabilities)
      .catch((e) => setError(e instanceof Error ? e.message : "Research Lab is unavailable"));
  }, []);

  const writer = capabilities?.capabilities.find((c) => c.id === "create_research_issue");
  const agent = capabilities?.capabilities.find((c) => c.id === "trigger_workspace_agent");

  async function research() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<{ evidence: Evidence[] }>({ action: "research", query });
      setEvidence(result.evidence);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setBusy(false);
    }
  }

  async function stageAgent() {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<StagedWrite>({
        action: "stage_write",
        kind: "agent_trigger",
        input: agentInput,
      });
      setStaged(result);
      setConfirmation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Agent run could not be staged");
    } finally {
      setBusy(false);
    }
  }

  async function stageWrite() {
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<StagedWrite>({
        action: "stage_write",
        kind: "issue",
        title: objective,
        body: details,
      });
      setStaged(result);
      setConfirmation("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Write request could not be staged");
    } finally {
      setBusy(false);
    }
  }

  async function confirmWrite() {
    if (!staged) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<{ issueUrl?: string; conversationUrl?: string; agentTriggerRunId?: string | null }>({
        action: "confirm_write",
        requestId: staged.requestId,
        confirmation,
      });
      if (result.conversationUrl) {
        setStatus({ url: result.conversationUrl, label: "Open agent conversation", runId: result.agentTriggerRunId });
        setAgentInput("");
      } else if (result.issueUrl) {
        setStatus({ url: result.issueUrl, label: "Issue created" });
        setObjective("");
        setDetails("");
      } else {
        throw new Error("Confirmed request returned no destination");
      }
      setStaged(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Confirmed request was not completed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-world="study" className="min-h-screen pb-16">
      <OniqHeader
        eyebrow="Research"
        title="ONIQ AGI Research Lab"
        subtitle="Evidence-first research over ONIQ's repository, with separately gated writes."
        back="/app/profile"
        actions={
          <Link
            to="/app/admin"
            className="press grid h-10 w-10 place-items-center rounded-full oniq-glass"
            aria-label="Open admin tools"
            title="Admin tools"
          >
            <ShieldCheck className="h-5 w-5" />
          </Link>
        }
      />

      <main className="px-5 pt-5">
        <div className="grid grid-cols-3 rounded-lg bg-muted p-1" role="tablist" aria-label="Research Lab mode">
          {(["research", "agent", "write"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={mode === item}
              onClick={() => { setMode(item); setStatus(null); }}
              disabled={busy || !!staged}
              className={`press flex items-center justify-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold disabled:opacity-50 ${mode === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {item === "research" ? <BookOpen className="h-4 w-4" /> : item === "agent" ? <Bot className="h-4 w-4" /> : <Github className="h-4 w-4" />}
              {item === "research" ? "Research" : item === "agent" ? "Agent" : "Issue"}
            </button>
          ))}
        </div>

        {capabilities && (
          <section className="mt-5" aria-labelledby="capabilities-title">
            <div className="flex items-center justify-between gap-3">
              <h2 id="capabilities-title" className="font-display text-lg font-bold">Configured capabilities</h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                {capabilities.repository.commit?.slice(0, 7) ?? "unknown"}
              </span>
            </div>
            <div className="mt-2 divide-y divide-border border-y border-border">
              {capabilities.capabilities.map((capability) => (
                <div key={capability.id} className="flex items-start gap-3 py-3">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${capability.available ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{capability.label}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{capability.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {mode === "research" ? (
          <section className="mt-6" aria-labelledby="research-title">
            <h2 id="research-title" className="font-display text-lg font-bold">Repository evidence</h2>
            <p className="mt-1 text-xs text-muted-foreground">Searches bounded text files on the live default branch. Results are excerpts, not claims of correctness.</p>
            <div className="mt-3 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void research()}
                placeholder="auth, routing, OQCA, file path..."
                aria-label="Repository research query"
                className="input-base min-w-0 flex-1"
                maxLength={120}
              />
              <button type="button" onClick={() => void research()} disabled={busy || !query.trim()} className="press grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50" aria-label="Search repository" title="Search repository">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FlaskConical className="h-5 w-5" />}
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {evidence.map((item) => (
                <article key={item.path} className="border-b border-border pb-4">
                  <a href={item.url} target="_blank" rel="noreferrer" className="break-all font-mono text-xs font-semibold text-world underline-offset-4 hover:underline">{item.path}</a>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[11px] leading-relaxed">{item.excerpt}</pre>
                </article>
              ))}
              {!busy && query && evidence.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No matching repository evidence loaded.</p>}
            </div>
          </section>
        ) : mode === "agent" ? (
          <section className="mt-6" aria-labelledby="agent-title">
            <h2 id="agent-title" className="font-display text-lg font-bold">Published Research Lab agent</h2>
            <p className="mt-1 text-xs text-muted-foreground">Queues one input on the configured ChatGPT API channel after a five-minute, one-time confirmation. The server access token never enters the browser.</p>
            <fieldset disabled={!agent?.available || busy || !!staged} className="mt-4 space-y-3 disabled:opacity-50">
              <textarea value={agentInput} onChange={(e) => setAgentInput(e.target.value)} placeholder="Research objective, evidence requirements, constraints, and desired output..." aria-label="Agent input" className="input-base min-h-40 w-full resize-y" maxLength={6000} />
              <button type="button" onClick={() => void stageAgent()} disabled={agentInput.trim().length < 2} className="press w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">Review agent run</button>
            </fieldset>
            {!agent?.available && capabilities && <p className="mt-3 rounded-lg border border-border p-3 text-xs text-muted-foreground">Workspace Agent access is not configured on the server. The channel is unavailable.</p>}
            {staged && (
              <div role="alertdialog" aria-labelledby="agent-confirm-title" className="mt-4 border-y border-amber-500/40 py-4">
                <h3 id="agent-confirm-title" className="font-semibold">Explicit confirmation required</h3>
                <p className="mt-1 text-xs text-muted-foreground">Type <span className="font-mono text-foreground">{staged.confirmationPhrase}</span>. This queues one live agent run, expires at {new Date(staged.expiresAt).toLocaleTimeString()}, and can be used once.</p>
                <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} aria-label="Agent confirmation phrase" className="input-base mt-3 w-full font-mono" autoComplete="off" />
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setStaged(null)} className="press flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold">Cancel</button>
                  <button type="button" onClick={() => void confirmWrite()} disabled={confirmation !== staged.confirmationPhrase || busy} className="press flex-1 rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50">Run agent</button>
                </div>
              </div>
            )}
            {status && <a href={status.url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-500"><CheckCircle2 className="h-4 w-4" />{status.label}{status.runId ? ` (${status.runId})` : ""}</a>}
          </section>
        ) : (
          <section className="mt-6" aria-labelledby="write-title">
            <h2 id="write-title" className="font-display text-lg font-bold">Research backlog issue</h2>
            <p className="mt-1 text-xs text-muted-foreground">The only write supported in v1. It creates one GitHub issue after a one-time confirmation. It cannot change code, branches, settings, deployments, or motion routing.</p>
            <fieldset disabled={!writer?.available || busy || !!staged} className="mt-4 space-y-3 disabled:opacity-50">
              <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Falsifiable research objective" aria-label="Issue title" className="input-base w-full" maxLength={160} />
              <textarea value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Evidence, baseline, acceptance criteria, risks..." aria-label="Issue details" className="input-base min-h-36 w-full resize-y" maxLength={6000} />
              <button type="button" onClick={() => void stageWrite()} disabled={objective.trim().length < 8 || details.trim().length < 20} className="press w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">Review write request</button>
            </fieldset>
            {!writer?.available && capabilities && <p className="mt-3 rounded-lg border border-border p-3 text-xs text-muted-foreground">Repository writes are not configured on the server. Research remains read-only.</p>}
            {staged && (
              <div role="alertdialog" aria-labelledby="confirm-title" className="mt-4 border-y border-amber-500/40 py-4">
                <h3 id="confirm-title" className="font-semibold">Explicit confirmation required</h3>
                <p className="mt-1 text-xs text-muted-foreground">Type <span className="font-mono text-foreground">{staged.confirmationPhrase}</span>. This approval expires at {new Date(staged.expiresAt).toLocaleTimeString()} and can be used once.</p>
                <input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} aria-label="Confirmation phrase" className="input-base mt-3 w-full font-mono" autoComplete="off" />
                <div className="mt-3 flex gap-2">
                  <button type="button" onClick={() => setStaged(null)} className="press flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold">Cancel</button>
                  <button type="button" onClick={() => void confirmWrite()} disabled={confirmation !== staged.confirmationPhrase || busy} className="press flex-1 rounded-lg bg-destructive px-4 py-2.5 text-sm font-semibold text-destructive-foreground disabled:opacity-50">Create issue</button>
                </div>
              </div>
            )}
            {status && <a href={status.url} target="_blank" rel="noreferrer" className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-500"><CheckCircle2 className="h-4 w-4" />{status.label}</a>}
          </section>
        )}

        {error && <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        <section className="mt-8 border-t border-border pt-5">
          <h2 className="font-display text-lg font-bold">OQCA production observation</h2>
          <p className="mt-1 text-xs text-muted-foreground">Runs the existing bounded OQCA observer. It may use the configured text budget, while its production tool-call budget remains zero.</p>
          <OqcaObserver />
        </section>
      </main>
    </div>
  );
}

function OqcaObserver() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke("oqca-observe", { body: {} });
    setBusy(false);
    setResult(error ? await edgeErrorMessage(error) : JSON.stringify(data, null, 2));
  };
  return (
    <div className="mt-3">
      <button type="button" data-testid="oqca-observe-run" onClick={() => void run()} disabled={busy} className="press rounded-lg border border-border px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{busy ? "Observing..." : "Observe ONIQ"}</button>
      {result !== null && <pre data-testid="oqca-observe-result" className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">{result}</pre>}
    </div>
  );
}

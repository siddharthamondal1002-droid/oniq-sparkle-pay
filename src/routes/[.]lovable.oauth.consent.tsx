import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Beta auth.oauth namespace — local typed wrapper for the three methods we call.
type AuthorizationDetails = {
  client?: { name?: string; redirect_uri?: string; client_uri?: string } | null;
  scope?: string;
  redirect_url?: string;
  redirect_to?: string;
};
type OAuthNamespace = {
  getAuthorizationDetails: (id: string) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};
function authOAuth(): OAuthNamespace {
  return (supabase.auth as unknown as { oauth: OAuthNamespace }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: the Supabase client reads its session from localStorage.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const next = location.pathname + location.searchStr;
      throw redirect({ to: "/mcp-signin", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await authOAuth().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#0E0F13] text-white">
      <div className="max-w-md rounded-2xl bg-[#16181E] p-6">
        <h1 className="text-xl font-semibold mb-2">Couldn't load this authorization</h1>
        <p className="text-sm text-white/70">{String((error as Error)?.message ?? error)}</p>
      </div>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await authOAuth().approveAuthorization(authorization_id)
      : await authOAuth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "an app";

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#0E0F13] text-white">
      <div className="w-full max-w-md rounded-2xl bg-[#16181E] border border-white/5 p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-[#00D4B8]">Connect to ONIQ</p>
          <h1 className="text-2xl font-semibold">Connect {clientName} to your ONIQ account</h1>
        </div>

        {email && (
          <div className="text-sm text-white/60">
            Signed in as <span className="text-white">{email}</span>
          </div>
        )}

        <p className="text-sm text-white/80">
          {clientName} will be able to call ONIQ's enabled tools while you're signed in — read your profile and conversation list.
        </p>

        <p className="text-xs text-white/50">
          This does not bypass ONIQ's permissions or backend policies. You can revoke access anytime in your account settings.
        </p>

        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-xl bg-[#00D4B8] text-black font-medium py-3 disabled:opacity-50"
          >
            {busy ? "Working…" : "Approve"}
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-xl bg-white/5 text-white font-medium py-3 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}

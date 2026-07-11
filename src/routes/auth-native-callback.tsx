import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth-native-callback")({
  head: () => ({
    meta: [
      { title: "Signing you in — ONIQ" },
      { name: "description", content: "Completing your ONIQ sign-in." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NativeCallback,
});

/** Read auth params from either the URL hash (#a=b&c=d) or the query string. */
export function parseAuthReturnParams(url: string): URLSearchParams {
  const u = new URL(url);
  const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
  const merged = new URLSearchParams(u.search);
  if (hash) {
    for (const [k, v] of new URLSearchParams(hash)) merged.set(k, v);
  }
  return merged;
}

/** Complete the Lovable broker return leg — mirrors processOAuthResponse in
 *  @lovable.dev/cloud-auth-js v1.1.2. Broker returns access_token +
 *  refresh_token (+ state) on success, or error/error_description on failure. */
export async function completeBrokerReturn(url: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = parseAuthReturnParams(url);
  const errParam = p.get("error_description") || p.get("error");
  if (errParam) return { ok: false, message: errParam };
  const access_token = p.get("access_token");
  const refresh_token = p.get("refresh_token");
  if (!access_token || !refresh_token) return { ok: false, message: "No tokens in callback" };
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

function NativeCallback() {
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const result = await completeBrokerReturn(window.location.href);
      if (!result.ok) {
        setErr(result.message);
        toast.error(`Sign-in didn't complete — ${result.message}`);
        return;
      }
      window.location.replace("/app");
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div className="max-w-sm">
        {err ? (
          <>
            <div className="text-4xl">😵‍💫</div>
            <h1 className="mt-3 font-display text-xl font-semibold">Sign-in hiccup</h1>
            <p className="mt-2 text-sm text-muted-foreground">{err}</p>
            <Link
              to="/auth"
              className="mt-5 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="text-4xl">✨</div>
            <p className="mt-3 text-sm text-muted-foreground">signing you in…</p>
          </>
        )}
      </div>
    </div>
  );
}

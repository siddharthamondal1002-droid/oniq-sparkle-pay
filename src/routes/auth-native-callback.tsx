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

function NativeCallback() {
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const errorParam = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (errorParam) {
      setErr(errorParam);
      toast.error(`Sign-in failed — ${errorParam}`);
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      setErr("No auth code in URL");
      return;
    }
    (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setErr(error.message);
        toast.error(`Sign-in didn't complete — ${error.message}`);
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

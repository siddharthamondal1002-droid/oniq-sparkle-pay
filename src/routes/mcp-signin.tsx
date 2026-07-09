import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

// Dedicated sign-in surface that preserves a `next` same-origin path across
// email sign-in / sign-up / Google — used by the OAuth consent route so users
// return to /.lovable/oauth/consent?authorization_id=… after auth.
export const Route = createFileRoute("/mcp-signin")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : "/app",
  }),
  component: McpSignIn,
});

function isSafeNext(next: string): boolean {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//");
}

function McpSignIn() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const safeNext = isSafeNext(next) ? next : "/app";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace(safeNext);
    });
  }, [safeNext]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + safeNext },
        });
        if (error) throw error;
        if (data.session) {
          window.location.replace(safeNext);
        } else {
          toast.success("Check your inbox to confirm your email 📬");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        window.location.replace(safeNext);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    if (loading) return;
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin + safeNext,
      });
      if (result.error) throw result.error;
      if (!result.redirected) window.location.replace(safeNext);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-[#0E0F13] text-white">
      <div className="w-full max-w-md rounded-2xl bg-[#16181E] border border-white/5 p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-[#00D4B8]">ONIQ</p>
          <h1 className="text-2xl font-semibold">Sign in to continue</h1>
          <p className="text-sm text-white/60">You'll return here to approve the connection.</p>
        </div>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full rounded-xl bg-white text-black font-medium py-3 disabled:opacity-50"
        >
          Continue with Google
        </button>

        <div className="text-center text-xs uppercase tracking-wide text-white/40">or</div>

        <form onSubmit={handleEmail} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-white"
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded-xl bg-black/40 border border-white/10 px-4 py-3 text-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#00D4B8] text-black font-medium py-3 disabled:opacity-50"
          >
            {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
          className="w-full text-center text-sm text-white/60 hover:text-white"
        >
          {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}

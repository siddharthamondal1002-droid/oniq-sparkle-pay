import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { ArrowLeft, Mail, Lock } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ONIQ" },
      { name: "description", content: "Sign in or create your free ONIQ account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);

  function friendlyAuthError(err: unknown): string {
    const raw =
      (err as { message?: string } | null)?.message ??
      (typeof err === "string" ? err : "") ??
      "";
    const msg = raw.toLowerCase();
    if (
      msg.includes("weak_password") ||
      msg.includes("pwned") ||
      msg.includes("leaked") ||
      msg.includes("compromised") ||
      msg.includes("password should")
    ) {
      return "That password's been leaked in breaches — pick a stronger one 🔐";
    }
    if (
      msg.includes("invalid_credentials") ||
      msg.includes("invalid login") ||
      msg.includes("invalid email or password")
    ) {
      return "Wrong email or password — no account found";
    }
    return raw || "Something went wrong";
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        toast.success("Account created — welcome to ONIQ");
        navigate({ to: "/app" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/app" });
      }
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/app" },
    });
    if (error) {
      toast.error(error.message || "Google sign-in failed");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background bg-hero p-5">
      <Link
        to="/"
        className="absolute left-5 top-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </Link>

      <div className="w-full max-w-md">
        <div className="text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent glow text-primary-foreground font-bold text-xl">
            O
          </div>
          <h1 className="mt-5 font-display text-3xl font-bold">
            {mode === "signin" ? "Welcome back" : "Join ONIQ"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "Sign in to enter your worlds." : "Create your free account in seconds."}
          </p>
        </div>

        <div className="mt-8 rounded-3xl border border-border glass p-6">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-card py-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <GoogleIcon />
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or with email
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-3">
            <Field
              icon={Mail}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              icon={Lock}
              type="password"
              placeholder="Password (min 6 chars)"
              value={password}
              onChange={setPassword}
              required
              minLength={6}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 block w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin"
              ? "New here? Create an account →"
              : "Already have an account? Sign in →"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to ONIQ's Terms and Privacy.
        </p>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  value,
  onChange,
  ...rest
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-input/40 py-3 pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l3.66-2.83z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Mail, Lock, Phone } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ONIQ" },
      { name: "description", content: "Sign in or create your free ONIQ account." },
    ],
  }),
  component: AuthPage,
});

/** Map raw Supabase auth errors to copy a human can act on. */
function friendlyAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.toLowerCase();
  if (m.includes("weak") || m.includes("pwned") || m.includes("breach")) {
    return "That password has shown up in data breaches — pick a stronger, unique one 🔐";
  }
  if (m.includes("invalid login credentials") || m.includes("invalid_credentials")) {
    return "Wrong email or password — no account found with those details";
  }
  if (m.includes("already registered") || m.includes("already exists")) {
    return "That email already has an account — sign in instead";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return "Too many attempts — take a breath and try again in a minute";
  }
  if (m.includes("confirm") && m.includes("email")) {
    return "Check your inbox — confirm your email to finish signing up 📬";
  }
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) {
    return "That sign-in is warming up — use email or phone for now ✨";
  }
  if (
    m.includes("sms provider") ||
    m.includes("phone provider") ||
    m.includes("sms not") ||
    m.includes("phone not") ||
    (m.includes("phone") && m.includes("not enabled")) ||
    (m.includes("sms") && m.includes("not configured"))
  ) {
    return "Phone sign-in isn't switched on yet — use email for now 📧";
  }
  return msg || "Something went wrong — try again";
}

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s|-/g, "");
  if (/^[6-9][0-9]{9}$/.test(trimmed)) return "+91" + trimmed;
  if (/^\+?[0-9]{8,15}$/.test(trimmed)) return trimmed.startsWith("+") ? trimmed : "+" + trimmed;
  return null;
}

function AuthPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/app" });
    });
  }, [navigate]);

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
        toast.success("Account created — welcome to ONIQ ✨");
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

  async function handleSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const normalized = normalizePhone(phone);
    if (!normalized) {
      toast.error("Enter a valid phone — try +91 98765 43210");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (error) throw error;
      setPhone(normalized);
      setOtpSent(true);
      toast.success("Code sent — check your SMS 📩");
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!/^[0-9]{6}$/.test(otp.trim())) {
      toast.error("That code should be 6 digits");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone,
        token: otp.trim(),
        type: "sms",
      });
      if (error) throw error;
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSocial(provider: "google" | "facebook" | "apple") {
    if (loading) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin + "/app" },
      });
      if (error) throw error;
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
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
          <div className="mb-4 grid grid-cols-2 rounded-2xl border border-border bg-card p-1 text-xs">
            <button
              type="button"
              onClick={() => { setMethod("email"); setOtpSent(false); }}
              className={`rounded-xl py-2 font-semibold ${method === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => { setMethod("phone"); }}
              className={`rounded-xl py-2 font-semibold ${method === "phone" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Phone
            </button>
          </div>

          {method === "email" ? (
            <>
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
                  placeholder="Password — strong & unique"
                  value={password}
                  onChange={setPassword}
                  required
                  minLength={8}
                />
                {mode === "signup" && (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    Common passwords get rejected for your safety — mix words, numbers & symbols.
                  </p>
                )}
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
            </>
          ) : (
            <>
              {!otpSent ? (
                <form onSubmit={handleSendOtp} className="space-y-3">
                  <Field
                    icon={Phone}
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={phone}
                    onChange={setPhone}
                    required
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? "Please wait…" : "Send OTP"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtp} className="space-y-3">
                  <p className="px-1 text-[11px] text-muted-foreground">
                    Code sent to {phone}
                  </p>
                  <Field
                    icon={Lock}
                    type="text"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={otp}
                    onChange={setOtp}
                    maxLength={6}
                    required
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? "Please wait…" : "Verify & sign in"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setOtpSent(false); setOtp(""); }}
                    className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    ← use a different number
                  </button>
                </form>
              )}
            </>
          )}

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or continue with
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <SocialButton label="Google" onClick={() => handleSocial("google")} disabled={loading} />
            <SocialButton label="Facebook" onClick={() => handleSocial("facebook")} disabled={loading} />
            <SocialButton label="Apple" onClick={() => handleSocial("apple")} disabled={loading} />
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to ONIQ's Terms and Privacy.
        </p>
      </div>
    </div>
  );
}

function SocialButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-border bg-card py-2.5 text-xs font-semibold text-foreground transition hover:border-primary/40 disabled:opacity-50"
    >
      {label}
    </button>
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
        className="w-full rounded-2xl border border-border bg-input/40 py-3 pl-10 pr-3 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none"
      />
    </div>
  );
}

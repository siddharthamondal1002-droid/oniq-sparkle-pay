import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { ArrowLeft, Mail, Lock, Phone } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ONIQ" },
      { name: "description", content: "Sign in or create your free ONIQ account to access messaging, payments, food, and every ONIQ world." },
      { property: "og:title", content: "Sign in — ONIQ" },
      { property: "og:description", content: "Open your ONIQ account — one login for every world." },
      { property: "og:url", content: "https://oniq-sparkle-pay.lovable.app/auth" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://oniq-sparkle-pay.lovable.app/auth" }],
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

const COUNTRIES: { flag: string; code: string; label: string }[] = [
  { flag: "🇮🇳", code: "+91", label: "India" },
  { flag: "🇺🇸", code: "+1", label: "USA" },
  { flag: "🇬🇧", code: "+44", label: "UK" },
  { flag: "🇦🇪", code: "+971", label: "UAE" },
  { flag: "🇸🇬", code: "+65", label: "Singapore" },
];

function AuthPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dialCode, setDialCode] = useState("+91");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);


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
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/app" },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Account created — welcome to ONIQ ✨");
          navigate({ to: "/app" });
        } else {
          setConfirmationSentTo(email);
        }
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

  function fullPhone(): string | null {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 8 || digits.length > 15) return null;
    return dialCode + digits;
  }

  async function handleSendOtp(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (loading) return;
    const normalized = fullPhone();
    if (!normalized) {
      toast.error("that number looks off — check the digits 📱");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (error) throw error;
      setOtpSent(true);
      setResendIn(30);
      toast.success("otp sent ✉️ check your messages");
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e?: React.FormEvent, codeOverride?: string) {
    if (e) e.preventDefault();
    if (loading) return;
    const code = (codeOverride ?? otp).trim();
    if (!/^[0-9]{6}$/.test(code)) {
      toast.error("that code should be 6 digits 🔢");
      return;
    }
    const normalized = fullPhone();
    if (!normalized) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        phone: normalized,
        token: code,
        type: "sms",
      });
      if (error) {
        const m = (error.message || "").toLowerCase();
        if (m.includes("rate") || m.includes("too many")) {
          toast.error("too many attempts 🚫 wait a bit");
        } else if (m.includes("invalid") || m.includes("expired")) {
          toast.error("invalid code — try again 🔄");
        } else {
          throw error;
        }
        return;
      }
      navigate({ to: "/app" });
    } catch (err) {
      toast.error(friendlyAuthError(err));
    } finally {
      setLoading(false);
    }
  }


  async function handleSocial(provider: "google" | "facebook" | "apple") {
    if (loading) return;
    if (provider === "facebook") {
      toast.info("Facebook sign-in isn't available yet — try Google or email");
      return;
    }
    setLoading(true);
    try {
      // Native (Capacitor) path: Google blocks OAuth inside embedded WebViews
      // (disallowed_useragent). Open the auth URL in a Chrome Custom Tab and
      // return via the com.oniqhub.app://auth-callback deep link.
      let isNative = false;
      try {
        const { Capacitor } = await import("@capacitor/core");
        isNative = typeof Capacitor?.isNativePlatform === "function" && Capacitor.isNativePlatform();
      } catch {
        isNative = false;
      }

      if (isNative && provider === "google") {
        // Route native OAuth through the SAME Lovable broker the web flow uses
        // (@lovable.dev/cloud-auth-js v1.1.2). Supabase's native `google`
        // provider is empty (no OAuth client configured) — it returns
        // "Unsupported provider: missing OAuth secret". The broker
        // (/~oauth/initiate) holds Lovable's managed Google client and
        // redirects back to redirect_uri with access_token + refresh_token in
        // the URL hash. We open the broker URL in a Chrome Custom Tab and
        // catch the return via App Links → appUrlOpen.
        const { initNativeAuth } = await import("@/lib/nativeAuth");
        await initNativeAuth();
        const state = crypto.getRandomValues(new Uint8Array(16))
          .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
        try { sessionStorage.setItem("oniq_oauth_state", state); } catch { /* ignore */ }
        const brokerOrigin = "https://oniqhub.com";
        const redirectUri = "https://oniqhub.com/auth-native-callback";
        const params = new URLSearchParams({
          provider: "google",
          redirect_uri: redirectUri,
          state,
        });
        const brokerUrl = `${brokerOrigin}/~oauth/initiate?${params.toString()}`;
        console.info("[native-oauth] broker url", brokerUrl.replace(state, "<state>"));
        const { Browser } = await import("@capacitor/browser");
        await Browser.open({ url: brokerUrl, presentationStyle: "popover" });
        return;
      }

      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin + "/app",
      });
      if (result.error) throw result.error;
      // On success, broker either redirects the browser or sets the session.
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
          {/* Real managed Google OAuth */}
          <button
            type="button"
            onClick={() => handleSocial("google")}
            disabled={loading}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white py-3 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-100 disabled:opacity-60"
          >
            <GoogleG />
            {loading ? "Connecting…" : "Continue with Google"}
          </button>
          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            or
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Method pill selector: email | phone */}
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-border bg-card/40 p-1 text-xs">
            <button
              type="button"
              onClick={() => { setMethod("email"); setOtpSent(false); setOtp(""); }}
              className={`rounded-full py-2 font-semibold transition ${method === "email" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              ✉️ Email
            </button>
            <button
              type="button"
              onClick={() => setMethod("phone")}
              className={`rounded-full py-2 font-semibold transition ${method === "phone" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              📱 Phone
            </button>
          </div>


          {method === "email" ? (
            confirmationSentTo ? (
              <div className="space-y-3 text-center">
                <div className="text-2xl">📬</div>
                <p className="font-display text-lg font-semibold">Confirm your email</p>
                <p className="text-xs text-muted-foreground">
                  We sent a link to <span className="text-foreground">{confirmationSentTo}</span>. Tap it, then sign in here.
                </p>
                <button
                  type="button"
                  onClick={() => { setConfirmationSentTo(null); setMode("signin"); setPassword(""); }}
                  className="w-full rounded-xl border border-border bg-card py-3 text-sm font-semibold hover:border-primary/40"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
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
                  <p className="px-1 text-xs text-muted-foreground">
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
            )
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
                  <p className="px-1 text-xs text-muted-foreground">
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

          {/* Social sign-in buttons hidden until providers are configured
              server-side. Store reviewers reject non-functional auth UI.
              Kept as dead code below for quick re-enable when providers ship. */}
          {false && (
            <>
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
            </>
          )}

        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          By continuing you agree to ONIQ's Terms and Privacy.
        </p>
      </div>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
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

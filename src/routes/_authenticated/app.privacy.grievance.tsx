import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Shield } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/app/privacy/grievance")({
  head: () => ({
    meta: [
      { title: "Grievance Officer — ONIQ" },
      {
        name: "description",
        content:
          "Contact ONIQ's Grievance Officer or file a formal complaint under India's DPDP Act, 2023.",
      },
    ],
  }),
  component: GrievancePage,
});

const OFFICER = {
  name: "Siddhartha Mondal",
  role: "Grievance Officer & Data Protection Officer",
  email: "grievance@oniqhub.com",
  phone: "+91 — available on written request",
  address: "ONIQ Hub, India",
};

const COMPLAINT_TYPES = [
  "Data access / correction / deletion",
  "Account safety or harassment",
  "Payments or wallet issue",
  "Content takedown",
  "Consent withdrawal",
  "Other",
];

const schema = z.object({
  name: z.string().trim().min(1, "Name required").max(120),
  email: z.string().trim().email("Enter a valid email").max(254),
  complaint_type: z.string().min(1, "Pick a category"),
  message: z.string().trim().min(5, "Describe the issue in at least 5 characters").max(4000),
});

function GrievancePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<{ id: string; email: string | null } | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    complaint_type: COMPLAINT_TYPES[0],
    message: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setMe({ id: data.user.id, email: data.user.email ?? null });
        setForm((f) => ({ ...f, email: data.user!.email ?? f.email }));
      }
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !me) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("grievances").insert({
        user_id: me.id,
        name: parsed.data.name,
        email: parsed.data.email,
        complaint_type: parsed.data.complaint_type,
        message: parsed.data.message,
      });
      if (error) throw error;
      toast.success("Complaint filed. We'll acknowledge within 7 days.");
      setTimeout(() => navigate({ to: "/app/profile" }), 800);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit — try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pt-[max(1rem,env(safe-area-inset-top))] pb-24">
      <div className="mx-auto max-w-2xl px-5">
        <Link
          to="/app/profile"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>

        <div className="mt-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">Grievance Officer</h1>
            <p className="text-xs text-muted-foreground">
              Under India's DPDP Act, 2023 and IT Rules, 2021
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2 rounded-2xl border border-border bg-card p-4 text-sm">
          <div>
            <div className="font-semibold">{OFFICER.name}</div>
            <div className="text-xs text-muted-foreground">{OFFICER.role}</div>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Email: </span>
            <a href={`mailto:${OFFICER.email}`} className="text-primary hover:underline">
              {OFFICER.email}
            </a>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Phone: </span>
            <span>{OFFICER.phone}</span>
          </div>
          <div className="text-xs">
            <span className="text-muted-foreground">Address: </span>
            <span>{OFFICER.address}</span>
          </div>
          <p className="pt-2 text-[11px] text-muted-foreground">
            Complaints acknowledged within 7 days. Serious safety complaints resolved within 36 hours.
          </p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">File a complaint</div>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Your name"
            maxLength={120}
            className="w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Reply-to email"
            maxLength={254}
            className="w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm outline-none focus:border-primary"
          />
          <select
            value={form.complaint_type}
            onChange={(e) => setForm({ ...form, complaint_type: e.target.value })}
            className="w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm outline-none focus:border-primary"
          >
            {COMPLAINT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <textarea
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="Describe the issue…"
            rows={6}
            maxLength={4000}
            className="w-full rounded-2xl border border-border bg-input/40 px-4 py-3 text-sm outline-none focus:border-primary resize-none"
          />
          <button
            type="submit"
            disabled={busy || !me}
            className="w-full rounded-2xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Submitting…" : "File complaint"}
          </button>
          <p className="px-1 text-[11px] text-muted-foreground">
            Submissions are stored securely and reviewed by the Grievance Officer.
          </p>
        </form>
      </div>
    </div>
  );
}

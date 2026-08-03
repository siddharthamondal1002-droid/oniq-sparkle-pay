import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Share2 } from "lucide-react";
import { toast } from "sonner";
import { CrisisCard } from "@/components/vitals/CrisisCard";
import { systemShare } from "@/lib/share";
import { healthWritesAllowed } from "@/lib/healthGuard";

export const Route = createFileRoute("/_authenticated/app/safety-plan")({
  component: SafetyPlanPage,
});

/**
 * Personal safety plan — Stanley–Brown structure, in the user's own words.
 * Stored ON THIS DEVICE ONLY (never uploaded); shared only on an explicit
 * tap. Copy deliberately contains no references to methods or means.
 */
const STORE_KEY = "oniq.safetyplan.v1";

type Plan = Record<string, string>;

const STEPS: { key: string; title: string; hint: string; placeholder: string }[] = [
  {
    key: "signs",
    title: "1 · Warning signs I notice",
    hint: "thoughts, moods, situations that tell me things are getting heavy",
    placeholder: "e.g. staying in bed all day, going quiet in the group chat…",
  },
  {
    key: "cope",
    title: "2 · Things that help me cope on my own",
    hint: "small things that have helped before",
    placeholder: "e.g. a walk, a shower, music, breathing for two minutes…",
  },
  {
    key: "distract",
    title: "3 · People and places that take my mind off things",
    hint: "company and places, even without talking about it",
    placeholder: "e.g. chai spot with friends, cousin's place, the park…",
  },
  {
    key: "ask",
    title: "4 · People I can ask for help",
    hint: "people I trust enough to tell how I'm really doing",
    placeholder: "name and number of a friend or family member…",
  },
  {
    key: "pros",
    title: "5 · Professionals and services I can contact",
    hint: "the support lines below are always available — add any doctor or counsellor you know",
    placeholder: "e.g. my counsellor's number, campus support…",
  },
  {
    key: "safer",
    title: "6 · Making my space feel safer",
    hint: "small, general changes that make my surroundings feel calmer and safer for a while",
    placeholder: "e.g. staying at a friend's tonight, asking someone to check in on me…",
  },
];

function SafetyPlanPage() {
  const [plan, setPlan] = useState<Plan>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // UAE (Federal Law 2/2019): a safety plan is health data — never read or
    // written on this device when Home is a country that disallows it.
    if (!healthWritesAllowed()) {
      try {
        localStorage.removeItem(STORE_KEY);
      } catch {
        /* noop */
      }
      setLoaded(true);
      return;
    }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) setPlan(JSON.parse(raw) as Plan);
    } catch {
      /* noop */
    }
    setLoaded(true);
  }, []);

  function update(key: string, value: string) {
    setPlan((prev) => {
      const next = { ...prev, [key]: value };
      if (!healthWritesAllowed()) return prev;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  }

  async function share() {
    const body = STEPS.map((s) => `${s.title}\n${plan[s.key]?.trim() || "—"}`).join("\n\n");
    const ok = await systemShare({
      title: "My safety plan",
      text: `My safety plan (from ONIQ)\n\n${body}`,
      url: "",
    });
    if (!ok) {
      try {
        await navigator.clipboard.writeText(body);
        toast.success("copied — paste it to someone you trust 💙");
      } catch {
        toast.error("couldn't share on this device");
      }
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <div className="px-5 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <Link
            to="/app/vitals"
            aria-label="Back to Vitals"
            className="press grid h-9 w-9 place-items-center rounded-full bg-surface-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">private 🔒</div>
            <h1 className="font-display text-2xl font-bold">my safety plan</h1>
          </div>
        </div>

        <p className="mt-3 text-sm text-muted-foreground">
          your own words, for the heavier days. saved only on this phone — nothing is uploaded.
          share it only if and when you choose to.
        </p>

        <div className="mt-5 space-y-4">
          {STEPS.map((s) => (
            <div key={s.key} className="rounded-2xl border border-border bg-card p-4">
              <label htmlFor={`sp-${s.key}`} className="block text-sm font-semibold">
                {s.title}
              </label>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.hint}</p>
              <textarea
                id={`sp-${s.key}`}
                value={plan[s.key] ?? ""}
                onChange={(e) => update(s.key, e.target.value)}
                placeholder={s.placeholder}
                rows={3}
                disabled={!loaded}
                className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div className="mt-5">
          <CrisisCard intro="these are always here — no account, no cost, no judgement." />
        </div>

        <button
          type="button"
          onClick={share}
          className="press mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card py-3 text-sm font-semibold"
        >
          <Share2 className="h-4 w-4" aria-hidden /> share with someone I trust
        </button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          sharing sends the text of your plan through apps on your phone — only when you tap.
        </p>
      </div>
    </div>
  );
}

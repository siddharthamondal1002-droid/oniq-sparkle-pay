import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Car, IndianRupee } from "lucide-react";
import { MINI_APPS, CATEGORY_LABELS, launchMiniApp, type MiniApp } from "@/lib/miniapps";

export const Route = createFileRoute("/_authenticated/app/miniapps")({
  component: MiniAppsScreen,
});

const CATEGORY_ORDER: MiniApp["category"][] = ["rides", "quickcommerce", "services", "food", "payments", "social", "shopping"];

function MiniAppsScreen() {
  return (
    <div className="px-5 pt-12 pb-6">
      <div className="flex items-center gap-3">
        <Link to="/app" className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Mini Apps</h1>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Every app you're lowkey addicted to, one tap away. Exit the other app and you land right back home. It's giving super app.
      </p>
      <p className="mt-1 text-xs text-muted-foreground/80">
        Apps open with your own accounts — ONIQ never sees their logins.
      </p>

      {/* Native ONIQ shortcuts */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          to="/app/rides"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <Car className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Book a ride</div>
            <div className="text-xs text-muted-foreground">Uber · Ola · Rapido</div>
          </div>
        </Link>
        <Link
          to="/app/upi"
          className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
            <IndianRupee className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold">Pay via UPI</div>
            <div className="text-xs text-muted-foreground">GPay · PhonePe · Paytm</div>
          </div>
        </Link>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const apps = MINI_APPS.filter((a) => a.category === cat);
        if (!apps.length) return null;
        return (
          <section key={cat}>
            <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="mt-3 space-y-2">
              {apps.map((app) => (
                <button
                  key={app.id}
                  onClick={() => launchMiniApp({ name: app.name, url: app.url, androidPackage: app.androidPackage })}
                  data-testid={`miniapp-${app.id}`}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40"
                >
                  <div
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl font-display text-lg font-bold text-white"
                    style={{ backgroundColor: app.color }}
                  >
                    {app.emoji ?? app.letter}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{app.name}</div>
                    <div className="text-xs text-muted-foreground">{app.tagline}</div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          </section>
        );
      })}

      {/* Government portals — emoji-only, no emblems/seals (State Emblem of India Act) */}
      <section>
        <h2 className="mt-6 px-1 font-display text-sm uppercase tracking-wider text-muted-foreground">
          gov 🇮🇳
        </h2>
        <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          Official government portals. ONIQ is not affiliated with, endorsed by, or acting on behalf of any government body. Links open the official websites.
        </p>
        <div className="mt-3 space-y-2">
          {GOV_PORTALS.map((g) => (
            <button
              key={g.url}
              onClick={() => launchMiniApp({ name: g.name, url: g.url })}
              className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left transition hover:border-primary/40"
            >
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-xl">
                {g.emoji}
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{g.name}</div>
                <div className="text-xs text-muted-foreground">{g.tagline}</div>
              </div>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Third-party apps are independent services. ONIQ opens them for your convenience.
      </p>
    </div>
  );
}

const GOV_PORTALS: { name: string; tagline: string; url: string; emoji: string }[] = [
  { name: "Grievances (CPGRAMS)", tagline: "File & track public grievances", url: "https://pgportal.gov.in", emoji: "📝" },
  { name: "Court case status (eCourts)", tagline: "Check case status online", url: "https://services.ecourts.gov.in", emoji: "⚖️" },
  { name: "All gov services", tagline: "India.gov.in services portal", url: "https://services.india.gov.in", emoji: "🏛️" },
  { name: "DigiLocker", tagline: "Your documents, digital", url: "https://www.digilocker.gov.in", emoji: "🗂️" },
  { name: "Income Tax", tagline: "File returns & track refunds", url: "https://www.incometax.gov.in", emoji: "💸" },
  { name: "GST", tagline: "GST portal", url: "https://www.gst.gov.in", emoji: "🧾" },
  { name: "Passport Seva", tagline: "Apply & track passport", url: "https://www.passportindia.gov.in", emoji: "🛂" },
  { name: "Aadhaar (UIDAI)", tagline: "Aadhaar services", url: "https://uidai.gov.in", emoji: "🆔" },
  { name: "EPFO", tagline: "Provident fund services", url: "https://www.epfindia.gov.in", emoji: "🏦" },
  { name: "RTO / vehicle (Parivahan)", tagline: "License & vehicle services", url: "https://parivahan.gov.in", emoji: "🚘" },
  { name: "Cybercrime", tagline: "Report cybercrime", url: "https://cybercrime.gov.in", emoji: "🛡️" },
  { name: "Consumer Helpline", tagline: "Consumer complaints", url: "https://consumerhelpline.gov.in", emoji: "📞" },
  { name: "KMC (Kolkata)", tagline: "Kolkata Municipal Corporation", url: "https://www.kmcgov.in", emoji: "🏙️" },
  { name: "West Bengal gov", tagline: "Government of West Bengal", url: "https://wb.gov.in", emoji: "🌆" },
];

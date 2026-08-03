import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck, UserCheck, FileKey } from "lucide-react";
import {
  approveParentalConsent,
  getAgeGateStatus,
  requestParentalConsent,
  submitDigilockerToken,
} from "@/lib/ageGate";

export const Route = createFileRoute("/_authenticated/app/privacy/parental-consent")({
  head: () => ({
    meta: [
      { title: "Parental consent — ONIQ" },
      {
        name: "description",
        content:
          "Verify parental consent for an ONIQ account under the age of digital consent, through a parent's ONIQ account or a DigiLocker age token.",
      },
      { property: "og:title", content: "Parental consent — ONIQ" },
      {
        property: "og:description",
        content:
          "Verifiable parental consent for under-age ONIQ accounts, recorded in the tamper-evident consent ledger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ParentalConsentPage,
});

function ParentalConsentPage() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: ["age-gate-status"],
    queryFn: getAgeGateStatus,
  });

  const [parentEmail, setParentEmail] = useState("");
  const [tokenRef, setTokenRef] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["age-gate-status"] });

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-[#0E0F13] pb-24 text-white">
      <header className="flex items-center gap-3 p-4">
        <Link to="/app/profile" aria-label="Back" className="rounded-full bg-white/10 p-2">
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-base font-semibold">Parental consent</h1>
      </header>

      <main className="space-y-4 px-4">
        {isLoading ? (
          <p className="text-sm text-white/60">Checking your account…</p>
        ) : null}

        {status ? (
          <section className="rounded-2xl bg-[#16181E] p-4 text-sm">
            <p className="text-white/60">
              Age of digital consent for your account:{" "}
              <span className="font-semibold text-white">{status.threshold}</span>
            </p>
            <p className="mt-1 text-white/60">
              Status:{" "}
              <span
                className={
                  status.verified
                    ? "font-semibold text-[#00D4B8]"
                    : status.restricted
                      ? "font-semibold text-amber-400"
                      : "font-semibold text-white"
                }
              >
                {status.verified
                  ? "Parental consent verified"
                  : status.restricted
                    ? "Restricted — nothing is being saved"
                    : "No parental consent needed"}
              </span>
            </p>
            {status.restricted ? (
              <p className="mt-2 text-xs leading-relaxed text-amber-200/90">
                Age verification is the only thing happening on this account right now.
                Posts, clips, status updates, tutor chats and quiz attempts are refused at
                the database — you will always see an error rather than a silent failure.
                Completing verification lifts this immediately; nothing already saved is
                lost.
              </p>
            ) : null}
          </section>
        ) : null}

        {status?.restricted ? (
          <>
            <section className="rounded-2xl bg-[#16181E] p-4">
              <div className="mb-2 flex items-center gap-2">
                <UserCheck className="size-4 text-[#00D4B8]" />
                <h2 className="text-sm font-semibold">A parent approves from their ONIQ account</h2>
              </div>
              <p className="text-xs leading-relaxed text-white/60">
                Enter your parent&apos;s email to get a one-time code. Your parent signs in to
                their own age-verified adult ONIQ account, opens this same page and enters the
                code. No third party, no documents.
              </p>
              {status.pending?.code ? (
                <div className="mt-3 rounded-xl bg-black/40 p-3 text-center">
                  <p className="text-xs text-white/50">Give this code to your parent</p>
                  <p className="mt-1 font-mono text-2xl tracking-widest text-[#00D4B8]">
                    {status.pending.code}
                  </p>
                </div>
              ) : null}
              <input
                type="email"
                inputMode="email"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                placeholder="parent@example.com"
                className="mt-3 w-full rounded-xl bg-black/40 px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => requestParentalConsent(parentEmail, "adult_account"), "Code created")}
                className="mt-3 w-full rounded-xl bg-[#00D4B8] py-2 text-sm font-semibold text-black disabled:opacity-50"
              >
                Get a code
              </button>
            </section>

            <section className="rounded-2xl bg-[#16181E] p-4">
              <div className="mb-2 flex items-center gap-2">
                <FileKey className="size-4 text-[#00D4B8]" />
                <h2 className="text-sm font-semibold">Or a DigiLocker age token</h2>
              </div>
              <p className="text-xs leading-relaxed text-white/60">
                Only the token reference is stored — never an Aadhaar number, never a
                government ID, never a document image. The database refuses anything that
                looks like an identifier.
              </p>
              <input
                value={tokenRef}
                onChange={(e) => setTokenRef(e.target.value)}
                placeholder="Token reference"
                className="mt-3 w-full rounded-xl bg-black/40 px-3 py-2 text-sm outline-none"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (status.pending?.method !== "digilocker") {
                      await requestParentalConsent("", "digilocker");
                    }
                    await submitDigilockerToken(tokenRef);
                  }, "Token reference recorded")
                }
                className="mt-3 w-full rounded-xl bg-white/10 py-2 text-sm font-semibold disabled:opacity-50"
              >
                Submit token reference
              </button>
            </section>
          </>
        ) : null}

        <section className="rounded-2xl bg-[#16181E] p-4">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#00D4B8]" />
            <h2 className="text-sm font-semibold">I am the parent</h2>
          </div>
          <p className="text-xs leading-relaxed text-white/60">
            Signed in on your own adult ONIQ account? Enter the code your child gave you.
            The approval is written into the tamper-evident consent ledger.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD1234"
            className="mt-3 w-full rounded-xl bg-black/40 px-3 py-2 font-mono text-sm tracking-widest outline-none"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => approveParentalConsent(code), "Consent recorded")}
            className="mt-3 w-full rounded-xl bg-[#00D4B8] py-2 text-sm font-semibold text-black disabled:opacity-50"
          >
            Approve
          </button>
        </section>

        <Link
          to="/app/privacy/notice"
          className="block rounded-2xl bg-[#16181E] p-4 text-sm text-white/70"
        >
          See the consent notice and my consent history →
        </Link>
      </main>
    </div>
  );
}

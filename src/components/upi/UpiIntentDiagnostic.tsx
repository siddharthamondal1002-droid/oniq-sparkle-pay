import { useState } from "react";
import { toast } from "sonner";
import { launchUpiIntent } from "@/lib/miniapps";
import { upiAmendability, isMerchantUpiUri } from "@/lib/upiPreference";

/**
 * THE DIFFERENTIAL HARNESS — why the ONIQ-mediated payment diverges from a
 * native PhonePe scan, answered with bytes instead of theories.
 *
 * Measured 2026-09-06: the SAME society QR paid successfully when scanned
 * inside PhonePe and failed when scanned by ONIQ. Payer, payee, amount and QR
 * are therefore all known-good, and the defect is somewhere in ONIQ's path.
 *
 * FOUR HYPOTHESES WERE KILLED FROM THE REPOSITORY, and none of them was it:
 *   · the router round trip — `raw` travels as a search param through
 *     stringifySearch/parseSearch; measured lossless, byte-identical
 *   · a non-URI QR (EMVCo/Bharat TLV) — resolveScannedCode returns "unknown"
 *     for anything that is not upi://pay, which never reaches the pay screen
 *   · merchant fields dropped by upiPayeeLink — fixed in a2cde2ad
 *   · encoding corruption from URLSearchParams — fixed in 47b5906b
 *
 * WHAT COULD NOT BE ESTABLISHED HERE is the only thing that now matters: the
 * ACTUAL bytes of the merchant's QR. Every test above ran against a fixture
 * someone invented. Whether that QR carries `sign`, what its `mode` is, and
 * whether it already carries `am` are all unknown, and each implies a
 * different defect. A diagnostic that reads the real code is the cheapest way
 * to stop guessing — this repository has spent a day proving that a confident
 * narrative built on one error string is the most expensive thing to produce.
 *
 * ON THE OWNER'S OWN REPRO THERE IS EXACTLY ONE VARIABLE LEFT, and that is
 * what makes this experiment worth a real payment. Scan and change nothing and
 * `rawIntact` is true, so `amendUpiUri` never runs and the query goes out byte
 * for byte as scanned — executed, both for an amount-less collection QR and
 * for one already carrying `am`. The single remaining difference is the SCHEME
 * that `retargetUpiUri` swaps in to skip Android's chooser:
 *
 *     scanned    upi://pay?pa=…&pn=…&mc=…&cu=INR
 *     ONIQ sends phonepe://pay?pa=…&pn=…&mc=…&cu=INR      query identical
 *
 * `tez://upi/pay` is Google's documented deep link. `phonepe://pay` and
 * `paytmmp://pay` are NOT documented here, and nothing in this repository ever
 * measured that they carry a full NPCI merchant payload the way the generic
 * `upi://pay` intent is required to. PhonePe's own scanner never receives such
 * a link — it decodes the QR internally — so this is precisely the ONIQ-only
 * step, and no amount of reading settles it. Only the handset does.
 *
 * TEST 1 vs TEST 2 IS THE WHOLE POINT. Test 1 hands `App.openUrl()` the
 * scanned string with NO parsing, NO amendment and NO retargeting — the
 * shortest possible path from camera to UPI app. Test 2 runs the production
 * pipeline. If 1 succeeds and 2 fails, the defect is in ONIQ's transformation
 * and the diff below names it. If BOTH fail while PhonePe's own scanner
 * succeeds, then no `upi://` intent can carry this payment and the answer is a
 * QR-first fallback, not another attempt at building a better string.
 *
 * IT SHOWS, IT DOES NOT SEND. Nothing here is logged, uploaded or persisted —
 * the text stays on the device unless the person taps copy. A merchant VPA is
 * not a secret, but it is somebody's payment identity and it has no reason to
 * leave the handset automatically.
 */
export function UpiIntentDiagnostic({ raw, finalUri }: { raw: string; finalUri: string }) {
  const [open, setOpen] = useState(false);

  const params = (uri: string): Array<[string, string]> => {
    const q = uri.indexOf("?");
    if (q < 0) return [];
    return uri
      .slice(q + 1)
      .split("&")
      .filter(Boolean)
      .map((pair) => {
        const eq = pair.indexOf("=");
        return eq < 0 ? [pair, ""] : [pair.slice(0, eq), pair.slice(eq + 1)];
      });
  };

  const scheme = (uri: string) => {
    const q = uri.indexOf("?");
    return q < 0 ? uri : uri.slice(0, q);
  };
  const queryOf = (uri: string) => {
    const q = uri.indexOf("?");
    return q < 0 ? "" : uri.slice(q + 1);
  };

  // THE LABEL THAT MAKES THIS AN EXPERIMENT RATHER THAN TWO BUTTONS. When the
  // query survives untouched, the scheme is the ONLY thing under test, and the
  // person about to spend real money should be told which single variable
  // their payment is measuring.
  const queryIdentical = queryOf(raw) === queryOf(finalUri);
  const schemeChanged = scheme(raw) !== scheme(finalUri);
  const schemeIsTheOnlyDiff = queryIdentical && schemeChanged;

  const rawPairs = params(raw);
  const finalPairs = params(finalUri);
  const finalMap = new Map(finalPairs);
  const keys = [...new Set([...rawPairs.map(([k]) => k), ...finalPairs.map(([k]) => k)])];
  const identical = raw === finalUri;

  async function copyAll() {
    const text = [
      "RAW QR   : " + raw,
      "FINAL URI: " + finalUri,
      "identical: " + identical,
      "amendability: " + upiAmendability(raw),
      "merchant (mc/mode/orgid/sign present): " + isMerchantUpiUri(raw),
      "query byte-identical: " + queryIdentical,
      "scheme: " + scheme(raw) + (schemeChanged ? " -> " + scheme(finalUri) : " (unchanged)"),
      "",
      ...keys.map((k) => {
        const a = rawPairs.find(([kk]) => kk === k)?.[1] ?? "(absent)";
        const b = finalMap.get(k) ?? "(absent)";
        return `${k.padEnd(8)} raw=${a}\n${" ".repeat(9)}out=${b}${a === b ? "" : "   <<< DIFFERS"}`;
      }),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Diagnostic copied");
    } catch {
      toast.error("Couldn't copy on this device");
    }
  }

  if (!raw) return null;

  return (
    <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-xs">
      <button
        type="button"
        data-testid="upi-diagnostic-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-start"
      >
        <span className="text-sm font-semibold text-foreground">
          What this app is about to send 🔎
        </span>
        <span className="text-muted-foreground">{open ? "hide" : "show"}</span>
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-muted-foreground">
            The scanned code and the exact string handed to Android, side by side. Nothing here
            leaves this phone unless you copy it.
          </p>

          <div>
            <div className="font-semibold text-foreground">Scanned QR</div>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-background p-2 text-[11px] break-all whitespace-pre-wrap">
              {raw}
            </pre>
          </div>

          <div>
            <div className="font-semibold text-foreground">
              Final URI {identical ? "— identical to the scan ✅" : "— DIFFERS from the scan ⚠️"}
            </div>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-background p-2 text-[11px] break-all whitespace-pre-wrap">
              {finalUri}
            </pre>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-1 text-start font-semibold">field</th>
                  <th className="pb-1 text-start font-semibold">scanned</th>
                  <th className="pb-1 text-start font-semibold">sent</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const a = rawPairs.find(([kk]) => kk === k)?.[1] ?? "(absent)";
                  const b = finalMap.get(k) ?? "(absent)";
                  const same = a === b;
                  return (
                    <tr key={k} className={same ? "" : "text-amber-500"}>
                      <td className="pe-2 align-top font-semibold">{k}</td>
                      <td className="pe-2 align-top break-all">{a}</td>
                      <td className="align-top break-all">{same ? "same" : b}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {schemeIsTheOnlyDiff && (
            <div
              data-testid="upi-diag-scheme-only"
              className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2"
            >
              <div className="font-semibold text-foreground">
                One difference only: the app is addressed directly
              </div>
              <div className="mt-1 text-muted-foreground">
                Everything after the <code>?</code> is byte-for-byte what the QR says. The only
                change is <code>{scheme(raw)}</code> → <code>{scheme(finalUri)}</code>, which skips
                Android&apos;s &ldquo;which app?&rdquo; chooser. Test 1 below sends the standard{" "}
                <code>{scheme(raw)}</code> form instead.
              </div>
            </div>
          )}

          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">Test 1</span> sends the scanned code
            with no processing at all — the shortest path there is. You&apos;ll be asked which app
            to use; pick the same one. <span className="font-semibold text-foreground">Test 2</span>{" "}
            is the normal Pay button. If Test 1 works and Test 2 does not, the fault is in this app.
          </p>

          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">Test 1 pays for real.</span> If it goes
            through, the money has moved and the answer is in — so try Test 1 first, and only try
            Test 2 if Test 1 also fails.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="upi-diag-launch-raw"
              onClick={() => void launchUpiIntent(raw)}
              className="press rounded-xl border border-border bg-background py-2.5 font-semibold"
            >
              Test 1 · send raw
            </button>
            <button
              type="button"
              data-testid="upi-diag-copy"
              onClick={() => void copyAll()}
              className="press rounded-xl border border-border bg-background py-2.5 font-semibold"
            >
              Copy diagnostic
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

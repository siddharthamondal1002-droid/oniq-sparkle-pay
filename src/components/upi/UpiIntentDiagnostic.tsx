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

          <p className="text-muted-foreground">
            <span className="font-semibold text-foreground">Test 1</span> sends the scanned code
            with no processing at all — the shortest path there is.{" "}
            <span className="font-semibold text-foreground">Test 2</span> is the normal Pay
            button. If Test 1 works and Test 2 does not, the fault is in this app.
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

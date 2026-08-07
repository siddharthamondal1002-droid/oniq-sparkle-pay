// Reading item arrays out of a Claude tool_use payload.
//
// Pure — no Deno globals, no imports — so the edge functions and the vitest
// suite import the same file. Same arrangement as _shared/mcqOrder.ts.
//
// WHY THIS IS NOT JUST `input[kind]`
//
// On 7 Aug the paper generator failed for a user roughly a third of the time.
// The logs said:
//
//   genSection no-items kind=long stop_reason=tool_use text_preview=""
//
// stop_reason=tool_use means the model DID call the tool — it answered. The
// old code read `input[kind]` and nothing else, so any payload shaped even
// slightly differently was thrown away, taking the whole paper with it
// (the mcq and short sections had generated perfectly).
//
// So: try the strict key first, because that is what the schema asks for. If
// it is absent but the payload carries exactly ONE array-valued property, use
// that — the model has answered, just under a name we did not predict, and
// binning a good section over a key name would be perverse.
//
// EXACTLY one, and that limit is the point. With two or more arrays there is
// no way to tell which is the section, and a guess could put the wrong content
// in front of a student. Ambiguity returns null and the caller retries.

export function extractItems(
  input: Record<string, unknown> | undefined | null,
  kind: string,
): unknown[] | null {
  if (!input || typeof input !== "object") return null;

  const direct = (input as Record<string, unknown>)[kind];
  if (Array.isArray(direct)) return direct;

  const arrays = Object.values(input).filter((v): v is unknown[] => Array.isArray(v));
  return arrays.length === 1 ? arrays[0] : null;
}

/**
 * A one-line description of what a tool payload actually contained.
 *
 * The old failure log said only "no items", which cannot distinguish an empty
 * payload from one keyed under an unexpected name — and that difference
 * decides whether the fix is a retry or a parser change. It cost a round trip
 * to the logs to find out; this makes the next one free.
 */
export function describePayload(input: Record<string, unknown> | undefined | null): string {
  if (!input) return "(no tool_use block)";
  const keys = Object.keys(input);
  if (!keys.length) return "(empty input object)";
  return keys
    .map((k) => {
      const v = input[k];
      if (Array.isArray(v)) return `${k}[${v.length}]`;
      return `${k}:${typeof v}`;
    })
    .join("|");
}
